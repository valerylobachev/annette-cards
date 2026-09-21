//! Audio endpoints and the attach flow with a fake TTS provider (no test calls a real service).

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use axum::{Router, http::StatusCode, http::header};
use serde_json::json;
use sqlx::SqlitePool;

use crate::{
    app,
    audio::{
        commons::{CommonsError, Recording, RecordingSource},
        handlers::{AUDIO_CACHE_CONTROL, X_AUDIO_ATTRIBUTION, X_AUDIO_SOURCE},
        service::SERVER_DEVICE,
        store::{self, NewAsset},
        test_cards::{CARD_UPDATED_AT, insert_card, insert_card_in},
        tts::{TtsAudio, TtsError, TtsProvider, TtsRequest, choose_voice},
    },
    security::AUDIO_REQUESTS_PER_HOUR,
    sync::pull,
    test_support::{PASSWORD, create_user, delete, get, login, post_json, send, test_state},
};

const FAKE_MP3: &[u8] = b"ID3 fake mp3 bytes";

/// Records the requests and answers with fixed bytes, or fails like an unreachable provider.
#[derive(Default)]
struct FakeTts {
    fail: bool,
    requests: Mutex<Vec<TtsRequest>>,
}

#[async_trait]
impl TtsProvider for FakeTts {
    async fn synthesize(&self, request: &TtsRequest) -> Result<TtsAudio, TtsError> {
        self.requests.lock().unwrap().push(request.clone());
        if self.fail {
            return Err(TtsError::Provider("connection refused".to_string()));
        }
        let (_, voice) = choose_voice(request)?;
        Ok(TtsAudio {
            bytes: FAKE_MP3.to_vec(),
            mime: "audio/mpeg".to_string(),
            voice,
        })
    }
}

/// Answers every lookup with the same result and records the `(word, lang)` pairs.
#[derive(Default)]
struct FakeRecordings {
    answer: Option<Recording>,
    fail: bool,
    lookups: Mutex<Vec<(String, String)>>,
}

#[async_trait]
impl RecordingSource for FakeRecordings {
    async fn find(&self, word: &str, lang: &str) -> Result<Option<Recording>, CommonsError> {
        self.lookups
            .lock()
            .unwrap()
            .push((word.to_string(), lang.to_string()));
        if self.fail {
            return Err(CommonsError("timeout".to_string()));
        }
        Ok(self.answer.clone())
    }
}

const ATTRIBUTION: &str =
    "Derbeth · CC BY 2.5 · https://commons.wikimedia.org/wiki/File:Pl-%C5%BC%C3%B3%C5%82w.ogg";

fn recording() -> Recording {
    Recording {
        bytes: FAKE_MP3.to_vec(),
        mime: "audio/mpeg".to_string(),
        attribution: ATTRIBUTION.to_string(),
        file_page: "https://commons.wikimedia.org/wiki/File:Pl-%C5%BC%C3%B3%C5%82w.ogg".to_string(),
    }
}

fn app_with_recordings(pool: SqlitePool, recordings: Arc<FakeRecordings>) -> Router {
    let mut state = test_state(pool);
    state.commons = Some(recordings as Arc<dyn RecordingSource>);
    app::router(Arc::new(state))
}

fn commons_body() -> serde_json::Value {
    json!({ "source": "commons" })
}

fn app_with(pool: SqlitePool, tts: Option<Arc<FakeTts>>) -> Router {
    let mut state = test_state(pool);
    state.tts = tts.map(|fake| fake as Arc<dyn TtsProvider>);
    app::router(Arc::new(state))
}

struct CardAudio {
    audio_id: Option<String>,
    updated_at: i64,
    updated_by: String,
    server_seq: i64,
}

async fn card_audio(pool: &SqlitePool, card_id: &str) -> CardAudio {
    sqlx::query_as!(
        CardAudio,
        "SELECT audio_id, updated_at, updated_by, server_seq FROM cards WHERE id = ?",
        card_id
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn asset_count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar!("SELECT COUNT(*) FROM audio_assets")
        .fetch_one(pool)
        .await
        .unwrap()
}

fn tts_body() -> serde_json::Value {
    json!({ "source": "tts" })
}

#[sqlx::test]
async fn attaching_tts_stores_the_clip_and_syncs_the_card(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    let card_id = insert_card(&pool, &anna.id, "read", Some("/rɛd/")).await;
    let before = card_audio(&pool, &card_id).await;
    let fake = Arc::new(FakeTts::default());
    let app = app_with(pool.clone(), Some(fake.clone()));
    let cookie = login(&app, "anna@example.com", PASSWORD).await;

    let uri = format!("/api/cards/{card_id}/audio");
    let response = send(&app, post_json(&uri, &tts_body(), Some(&cookie))).await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.body);
    assert_eq!(response.body["attribution"], serde_json::Value::Null);
    let audio_id = response.body["audio_id"].as_str().unwrap().to_string();

    // The provider got the front, the deck's language and the IPA hint.
    let requests = fake.requests.lock().unwrap().clone();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].text, "read");
    assert_eq!(requests[0].lang, "en-GB");
    assert_eq!(requests[0].ipa.as_deref(), Some("/rɛd/"));

    let asset = store::get_asset(&pool, &anna.id, &audio_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(asset.source, "azure");
    assert_eq!(asset.bytes, FAKE_MP3);

    let after = card_audio(&pool, &card_id).await;
    assert_eq!(after.audio_id.as_deref(), Some(audio_id.as_str()));
    assert_eq!(after.updated_by, SERVER_DEVICE);
    assert!(after.updated_at > before.updated_at);
    assert!(after.server_seq > before.server_seq);

    // Another device that already pulled up to the old row gets the card again.
    let page = pull::pull(&pool, &anna.id, before.server_seq, 100)
        .await
        .unwrap();
    let pulled: Vec<_> = page
        .changes
        .cards
        .iter()
        .filter(|card| card.id == card_id)
        .collect();
    assert_eq!(pulled.len(), 1);
    assert_eq!(pulled[0].audio_id.as_deref(), Some(audio_id.as_str()));
}

#[sqlx::test]
async fn the_server_stamp_beats_a_card_stamped_in_the_future(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    let card_id = insert_card(&pool, &anna.id, "read", None).await;
    let far_future = i64::MAX / 2;
    sqlx::query!(
        "UPDATE cards SET updated_at = ? WHERE id = ?",
        far_future,
        card_id
    )
    .execute(&pool)
    .await
    .unwrap();
    let app = app_with(pool.clone(), Some(Arc::new(FakeTts::default())));
    let cookie = login(&app, "anna@example.com", PASSWORD).await;

    let uri = format!("/api/cards/{card_id}/audio");
    let response = send(&app, post_json(&uri, &tts_body(), Some(&cookie))).await;
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(card_audio(&pool, &card_id).await.updated_at, far_future + 1);
}

#[sqlx::test]
async fn another_users_card_is_not_found_and_nothing_is_written(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    create_user(&pool, "boris@example.com", false).await;
    let card_id = insert_card(&pool, &anna.id, "read", None).await;
    let fake = Arc::new(FakeTts::default());
    let app = app_with(pool.clone(), Some(fake.clone()));
    let boris = login(&app, "boris@example.com", PASSWORD).await;

    let uri = format!("/api/cards/{card_id}/audio");
    let response = send(&app, post_json(&uri, &tts_body(), Some(&boris))).await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
    assert_eq!(response.code(), "not_found");
    let response = send(&app, delete(&uri, Some(&boris))).await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);

    assert!(
        fake.requests.lock().unwrap().is_empty(),
        "the provider was not called"
    );
    assert_eq!(asset_count(&pool).await, 0);
    assert_eq!(
        card_audio(&pool, &card_id).await.updated_at,
        CARD_UPDATED_AT
    );
}

#[sqlx::test]
async fn a_deleted_card_is_not_found(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    let card_id = insert_card(&pool, &anna.id, "read", None).await;
    sqlx::query!("UPDATE cards SET deleted_at = 5 WHERE id = ?", card_id)
        .execute(&pool)
        .await
        .unwrap();
    let app = app_with(pool.clone(), Some(Arc::new(FakeTts::default())));
    let cookie = login(&app, "anna@example.com", PASSWORD).await;

    let uri = format!("/api/cards/{card_id}/audio");
    let response = send(&app, post_json(&uri, &tts_body(), Some(&cookie))).await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn a_provider_failure_changes_nothing(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    let card_id = insert_card(&pool, &anna.id, "read", None).await;
    let before = card_audio(&pool, &card_id).await;
    let fake = Arc::new(FakeTts {
        fail: true,
        ..FakeTts::default()
    });
    let app = app_with(pool.clone(), Some(fake));
    let cookie = login(&app, "anna@example.com", PASSWORD).await;

    let uri = format!("/api/cards/{card_id}/audio");
    let response = send(&app, post_json(&uri, &tts_body(), Some(&cookie))).await;
    assert_eq!(response.status, StatusCode::BAD_GATEWAY);
    assert_eq!(response.code(), "provider_error");
    assert_eq!(asset_count(&pool).await, 0);
    let after = card_audio(&pool, &card_id).await;
    assert_eq!(after.audio_id, None);
    assert_eq!(after.server_seq, before.server_seq);
}

#[sqlx::test]
async fn a_language_without_a_voice_is_refused(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    let card_id = insert_card_in(&pool, &anna.id, "xx-XX", "word", None).await;
    let app = app_with(pool.clone(), Some(Arc::new(FakeTts::default())));
    let cookie = login(&app, "anna@example.com", PASSWORD).await;

    let uri = format!("/api/cards/{card_id}/audio");
    let response = send(&app, post_json(&uri, &tts_body(), Some(&cookie))).await;
    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    assert_eq!(response.code(), "unsupported_language");
    assert_eq!(asset_count(&pool).await, 0);
}

#[sqlx::test]
async fn request_body_is_validated(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    let card_id = insert_card(&pool, &anna.id, "read", None).await;
    let fake = Arc::new(FakeTts::default());
    let app = app_with(pool.clone(), Some(fake.clone()));
    let cookie = login(&app, "anna@example.com", PASSWORD).await;
    let uri = format!("/api/cards/{card_id}/audio");

    let voice = send(
        &app,
        post_json(
            &uri,
            &json!({ "source": "tts", "voice": "x\"/>" }),
            Some(&cookie),
        ),
    )
    .await;
    assert_eq!(voice.status, StatusCode::BAD_REQUEST);
    assert_eq!(voice.code(), "validation_failed");
    let source = send(
        &app,
        post_json(&uri, &json!({ "source": "radio" }), Some(&cookie)),
    )
    .await;
    assert_eq!(source.code(), "validation_failed");
    let commons = send(
        &app,
        post_json(&uri, &json!({ "source": "commons" }), Some(&cookie)),
    )
    .await;
    assert_eq!(commons.status, StatusCode::CONFLICT);
    assert_eq!(commons.code(), "commons_disabled");

    let explicit = json!({ "source": "tts", "voice": "en-GB-RyanNeural" });
    let response = send(&app, post_json(&uri, &explicit, Some(&cookie))).await;
    assert_eq!(response.status, StatusCode::OK);
    let requests = fake.requests.lock().unwrap();
    assert_eq!(
        requests.last().unwrap().voice.as_deref(),
        Some("en-GB-RyanNeural")
    );
}

#[sqlx::test]
async fn removing_audio_clears_the_card_and_keeps_the_clip(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    let card_id = insert_card(&pool, &anna.id, "read", None).await;
    let app = app_with(pool.clone(), Some(Arc::new(FakeTts::default())));
    let cookie = login(&app, "anna@example.com", PASSWORD).await;
    let uri = format!("/api/cards/{card_id}/audio");
    let attached = send(&app, post_json(&uri, &tts_body(), Some(&cookie))).await;
    let audio_id = attached.body["audio_id"].as_str().unwrap().to_string();
    let with_audio = card_audio(&pool, &card_id).await;

    let response = send(&app, delete(&uri, Some(&cookie))).await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    let removed = card_audio(&pool, &card_id).await;
    assert_eq!(removed.audio_id, None);
    assert_eq!(removed.updated_by, SERVER_DEVICE);
    assert!(removed.server_seq > with_audio.server_seq);
    assert!(removed.updated_at > with_audio.updated_at);
    assert_eq!(asset_count(&pool).await, 1);
    let clip = send(&app, get(&format!("/api/audio/{audio_id}"), Some(&cookie))).await;
    assert_eq!(
        clip.status,
        StatusCode::OK,
        "a cached reference keeps working"
    );

    // Removing again is a no-op: no new server_seq for other devices to pull.
    let response = send(&app, delete(&uri, Some(&cookie))).await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    assert_eq!(
        card_audio(&pool, &card_id).await.server_seq,
        removed.server_seq
    );
}

#[sqlx::test]
async fn a_clip_is_served_with_cache_and_source_headers(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    create_user(&pool, "boris@example.com", false).await;
    let card_id = insert_card(&pool, &anna.id, "żółw", None).await;
    let mut conn = pool.acquire().await.unwrap();
    let recording = NewAsset {
        user_id: &anna.id,
        card_id: &card_id,
        source: "commons",
        mime: "audio/mpeg",
        voice: None,
        attribution: Some("Jan Kowalski, CC BY-SA 4.0"),
        bytes: FAKE_MP3,
    };
    let audio_id = store::insert_asset(&mut conn, recording, 1).await.unwrap();
    drop(conn);
    let app = app_with(pool.clone(), None);
    let anna_cookie = login(&app, "anna@example.com", PASSWORD).await;
    let boris_cookie = login(&app, "boris@example.com", PASSWORD).await;
    let uri = format!("/api/audio/{audio_id}");

    let response = send(&app, get(&uri, Some(&anna_cookie))).await;
    assert_eq!(response.status, StatusCode::OK);
    let headers = &response.headers;
    assert_eq!(headers[header::CONTENT_TYPE], "audio/mpeg");
    assert_eq!(headers[header::CACHE_CONTROL], AUDIO_CACHE_CONTROL);
    assert_eq!(headers[X_AUDIO_SOURCE], "commons");
    assert_eq!(
        headers[X_AUDIO_ATTRIBUTION],
        "Jan%20Kowalski%2C%20CC%20BY-SA%204.0"
    );
    assert_eq!(response.body.as_str().unwrap().as_bytes(), FAKE_MP3);

    let other = send(&app, get(&uri, Some(&boris_cookie))).await;
    assert_eq!(other.status, StatusCode::NOT_FOUND);
    assert_eq!(other.code(), "not_found");
    let anonymous = send(&app, get(&uri, None)).await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn generated_audio_has_no_attribution_header(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    let card_id = insert_card(&pool, &anna.id, "read", None).await;
    let app = app_with(pool.clone(), Some(Arc::new(FakeTts::default())));
    let cookie = login(&app, "anna@example.com", PASSWORD).await;
    let attached = send(
        &app,
        post_json(
            &format!("/api/cards/{card_id}/audio"),
            &tts_body(),
            Some(&cookie),
        ),
    )
    .await;
    let audio_id = attached.body["audio_id"].as_str().unwrap();

    let response = send(&app, get(&format!("/api/audio/{audio_id}"), Some(&cookie))).await;
    assert_eq!(response.headers[X_AUDIO_SOURCE], "azure");
    assert!(!response.headers.contains_key(X_AUDIO_ATTRIBUTION));
}

#[sqlx::test]
async fn without_a_provider_tts_is_disabled(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    let card_id = insert_card(&pool, &anna.id, "read", None).await;
    let app = app_with(pool.clone(), None);
    let cookie = login(&app, "anna@example.com", PASSWORD).await;

    let response = send(
        &app,
        post_json(
            &format!("/api/cards/{card_id}/audio"),
            &tts_body(),
            Some(&cookie),
        ),
    )
    .await;
    assert_eq!(response.status, StatusCode::CONFLICT);
    assert_eq!(response.code(), "tts_disabled");
    let meta = send(&app, get("/api/meta", None)).await;
    assert_eq!(meta.body["features"]["tts"], false);

    let enabled = app_with(pool, Some(Arc::new(FakeTts::default())));
    let meta = send(&enabled, get("/api/meta", None)).await;
    assert_eq!(meta.body["features"]["tts"], true);
}

#[sqlx::test]
async fn the_61st_request_in_an_hour_is_rate_limited(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    create_user(&pool, "boris@example.com", false).await;
    let card_id = insert_card(&pool, &anna.id, "read", None).await;
    let app = app_with(pool.clone(), Some(Arc::new(FakeTts::default())));
    let cookie = login(&app, "anna@example.com", PASSWORD).await;
    let uri = format!("/api/cards/{card_id}/audio");

    for attempt in 1..=AUDIO_REQUESTS_PER_HOUR {
        let response = send(&app, post_json(&uri, &tts_body(), Some(&cookie))).await;
        assert_eq!(response.status, StatusCode::OK, "attempt {attempt}");
    }
    let limited = send(&app, post_json(&uri, &tts_body(), Some(&cookie))).await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(limited.code(), "rate_limited");

    // Other users and removing audio are not limited.
    let boris = login(&app, "boris@example.com", PASSWORD).await;
    let other = send(&app, post_json(&uri, &tts_body(), Some(&boris))).await;
    assert_eq!(other.status, StatusCode::NOT_FOUND);
    let removed = send(&app, delete(&uri, Some(&cookie))).await;
    assert_eq!(removed.status, StatusCode::NO_CONTENT);
}

#[sqlx::test]
async fn a_recording_is_attached_with_its_attribution(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    let card_id = insert_card_in(&pool, &anna.id, "pl-PL", "żółw", None).await;
    let before = card_audio(&pool, &card_id).await;
    let fake = Arc::new(FakeRecordings {
        answer: Some(recording()),
        ..FakeRecordings::default()
    });
    let app = app_with_recordings(pool.clone(), fake.clone());
    let cookie = login(&app, "anna@example.com", PASSWORD).await;

    let uri = format!("/api/cards/{card_id}/audio");
    let response = send(&app, post_json(&uri, &commons_body(), Some(&cookie))).await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.body);
    assert_eq!(response.body["attribution"], ATTRIBUTION);
    let audio_id = response.body["audio_id"].as_str().unwrap();
    assert_eq!(
        fake.lookups.lock().unwrap().as_slice(),
        [("żółw".to_string(), "pl-PL".to_string())]
    );

    let after = card_audio(&pool, &card_id).await;
    assert_eq!(after.audio_id.as_deref(), Some(audio_id));
    assert_eq!(after.updated_by, SERVER_DEVICE);
    assert!(after.server_seq > before.server_seq);

    let clip = send(&app, get(&format!("/api/audio/{audio_id}"), Some(&cookie))).await;
    assert_eq!(clip.headers[X_AUDIO_SOURCE], "commons");
    let encoded = clip.headers[X_AUDIO_ATTRIBUTION].to_str().unwrap();
    assert!(
        encoded.starts_with("Derbeth%20%C2%B7%20CC%20BY%202.5"),
        "{encoded}"
    );
}

#[sqlx::test]
async fn no_recording_is_not_found_and_changes_nothing(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    let card_id = insert_card(&pool, &anna.id, "read", None).await;
    let app = app_with_recordings(pool.clone(), Arc::new(FakeRecordings::default()));
    let cookie = login(&app, "anna@example.com", PASSWORD).await;

    let uri = format!("/api/cards/{card_id}/audio");
    let response = send(&app, post_json(&uri, &commons_body(), Some(&cookie))).await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
    assert_eq!(response.code(), "not_found");
    assert_eq!(asset_count(&pool).await, 0);
    assert_eq!(
        card_audio(&pool, &card_id).await.updated_at,
        CARD_UPDATED_AT
    );
}

#[sqlx::test]
async fn a_failed_lookup_is_a_provider_error(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    let card_id = insert_card(&pool, &anna.id, "read", None).await;
    let fake = Arc::new(FakeRecordings {
        fail: true,
        ..FakeRecordings::default()
    });
    let app = app_with_recordings(pool.clone(), fake);
    let cookie = login(&app, "anna@example.com", PASSWORD).await;

    let uri = format!("/api/cards/{card_id}/audio");
    let response = send(&app, post_json(&uri, &commons_body(), Some(&cookie))).await;
    assert_eq!(response.status, StatusCode::BAD_GATEWAY);
    assert_eq!(response.code(), "provider_error");
    assert_eq!(asset_count(&pool).await, 0);
}

#[sqlx::test]
async fn recordings_of_another_users_card_are_not_looked_up(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    create_user(&pool, "boris@example.com", false).await;
    let card_id = insert_card(&pool, &anna.id, "read", None).await;
    let fake = Arc::new(FakeRecordings {
        answer: Some(recording()),
        ..FakeRecordings::default()
    });
    let app = app_with_recordings(pool.clone(), fake.clone());
    let boris = login(&app, "boris@example.com", PASSWORD).await;

    let uri = format!("/api/cards/{card_id}/audio");
    let response = send(&app, post_json(&uri, &commons_body(), Some(&boris))).await;
    assert_eq!(response.status, StatusCode::NOT_FOUND);
    assert!(fake.lookups.lock().unwrap().is_empty());
    assert_eq!(asset_count(&pool).await, 0);
}

#[sqlx::test]
async fn commons_can_be_turned_off(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    let card_id = insert_card(&pool, &anna.id, "read", None).await;
    // test_config turns Commons off, like ANNETTE_COMMONS_ENABLED=false.
    let app = app_with(pool.clone(), None);
    let cookie = login(&app, "anna@example.com", PASSWORD).await;

    let uri = format!("/api/cards/{card_id}/audio");
    let response = send(&app, post_json(&uri, &commons_body(), Some(&cookie))).await;
    assert_eq!(response.status, StatusCode::CONFLICT);
    assert_eq!(response.code(), "commons_disabled");
    let meta = send(&app, get("/api/meta", None)).await;
    assert_eq!(meta.body["features"]["commons"], false);

    let enabled = app_with_recordings(pool, Arc::new(FakeRecordings::default()));
    let meta = send(&enabled, get("/api/meta", None)).await;
    assert_eq!(meta.body["features"]["commons"], true);
}

#[sqlx::test]
async fn tts_and_recordings_share_the_rate_limit(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    let card_id = insert_card(&pool, &anna.id, "read", None).await;
    let mut state = test_state(pool.clone());
    state.tts = Some(Arc::new(FakeTts::default()) as Arc<dyn TtsProvider>);
    state.commons = Some(Arc::new(FakeRecordings {
        answer: Some(recording()),
        ..FakeRecordings::default()
    }) as Arc<dyn RecordingSource>);
    let app = app::router(Arc::new(state));
    let cookie = login(&app, "anna@example.com", PASSWORD).await;
    let uri = format!("/api/cards/{card_id}/audio");

    for attempt in 1..=AUDIO_REQUESTS_PER_HOUR {
        let body = if attempt % 2 == 0 {
            tts_body()
        } else {
            commons_body()
        };
        let response = send(&app, post_json(&uri, &body, Some(&cookie))).await;
        assert_eq!(response.status, StatusCode::OK, "attempt {attempt}");
    }
    let limited = send(&app, post_json(&uri, &commons_body(), Some(&cookie))).await;
    assert_eq!(limited.code(), "rate_limited");
}
