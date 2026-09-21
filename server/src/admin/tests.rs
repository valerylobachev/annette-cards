//! Router tests for `/api/admin/invites`.

use axum::http::StatusCode;
use serde_json::json;
use sqlx::SqlitePool;

use crate::{
    admin::invites,
    clock::{DAY_MS, now_ms},
    test_support::{PASSWORD, create_user, delete, get, login, post_json, send, test_app},
};

async fn admin_app(pool: &SqlitePool) -> (axum::Router, String) {
    create_user(pool, "admin@example.com", true).await;
    let app = test_app(pool.clone());
    let cookie = login(&app, "admin@example.com", PASSWORD).await;
    (app, cookie)
}

#[sqlx::test]
async fn admin_creates_lists_and_revokes_invites(pool: SqlitePool) {
    let (app, admin) = admin_app(&pool).await;

    let created = send(
        &app,
        post_json(
            "/api/admin/invites",
            &json!({ "note": "Anna", "days": 3 }),
            Some(&admin),
        ),
    )
    .await;
    assert_eq!(created.status, StatusCode::CREATED);
    let code = created.body["code"].as_str().unwrap().to_string();
    assert_eq!(code.len(), invites::CODE_LEN);
    assert_eq!(created.body["note"], "Anna");
    assert_eq!(created.body["status"], "active");
    let expires_at = created.body["expires_at"].as_i64().unwrap();
    assert!((expires_at - (now_ms() + 3 * DAY_MS)).abs() < 60_000);

    let default_days = send(
        &app,
        post_json("/api/admin/invites", &json!({}), Some(&admin)),
    )
    .await;
    let expires_at = default_days.body["expires_at"].as_i64().unwrap();
    assert!((expires_at - (now_ms() + 7 * DAY_MS)).abs() < 60_000);

    let listed = send(&app, get("/api/admin/invites", Some(&admin))).await;
    assert_eq!(listed.status, StatusCode::OK);
    assert_eq!(listed.body.as_array().unwrap().len(), 2);

    let revoked = send(
        &app,
        delete(&format!("/api/admin/invites/{code}"), Some(&admin)),
    )
    .await;
    assert_eq!(revoked.status, StatusCode::NO_CONTENT);
    let listed = send(&app, get("/api/admin/invites", Some(&admin))).await;
    assert_eq!(listed.body.as_array().unwrap().len(), 1);

    let again = send(
        &app,
        delete(&format!("/api/admin/invites/{code}"), Some(&admin)),
    )
    .await;
    assert_eq!(again.status, StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn invite_days_are_validated(pool: SqlitePool) {
    let (app, admin) = admin_app(&pool).await;
    for days in [0, 91] {
        let response = send(
            &app,
            post_json("/api/admin/invites", &json!({ "days": days }), Some(&admin)),
        )
        .await;
        assert_eq!(response.status, StatusCode::BAD_REQUEST);
        assert_eq!(response.code(), "validation_failed");
    }
}

#[sqlx::test]
async fn status_covers_active_used_and_expired(pool: SqlitePool) {
    let (app, admin) = admin_app(&pool).await;
    let admin_id = crate::auth::users::first_admin(&pool)
        .await
        .unwrap()
        .unwrap()
        .id;
    invites::create_invite(&pool, &admin_id, Some("active"), 7, now_ms())
        .await
        .unwrap();
    invites::create_invite(&pool, &admin_id, Some("expired"), 1, now_ms() - 2 * DAY_MS)
        .await
        .unwrap();
    let used = invites::create_invite(&pool, &admin_id, Some("used"), 5, now_ms())
        .await
        .unwrap();
    let register = json!({
        "invite_code": used.code, "display_name": "Bob", "email": "bob@example.com", "password": "bob's long password",
    });
    assert_eq!(
        send(&app, post_json("/api/auth/register", &register, None))
            .await
            .status,
        StatusCode::OK
    );

    let listed = send(&app, get("/api/admin/invites", Some(&admin))).await;
    let statuses: Vec<(String, String)> = listed
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|invite| {
            (
                invite["note"].as_str().unwrap().into(),
                invite["status"].as_str().unwrap().into(),
            )
        })
        .collect();
    assert_eq!(
        statuses,
        [
            ("active".into(), "active".into()),
            ("used".into(), "used".into()),
            ("expired".into(), "expired".into())
        ]
    );
    let used_row = &listed.body[1];
    assert_eq!(used_row["used_by_email"], "bob@example.com");
    assert!(used_row["used_at"].is_i64());

    let revoke_used = send(
        &app,
        delete(&format!("/api/admin/invites/{}", used.code), Some(&admin)),
    )
    .await;
    assert_eq!(revoke_used.status, StatusCode::CONFLICT);
    assert_eq!(revoke_used.code(), "invite_used");
}

#[sqlx::test]
async fn only_admins_manage_invites(pool: SqlitePool) {
    create_user(&pool, "user@example.com", false).await;
    let app = test_app(pool);
    let user = login(&app, "user@example.com", PASSWORD).await;

    let requests = [
        get("/api/admin/invites", Some(&user)),
        post_json("/api/admin/invites", &json!({}), Some(&user)),
        delete("/api/admin/invites/ABCDEFGHJKMN", Some(&user)),
    ];
    for request in requests {
        let response = send(&app, request).await;
        assert_eq!(response.status, StatusCode::FORBIDDEN);
        assert_eq!(response.code(), "forbidden");
    }

    let anonymous = send(&app, get("/api/admin/invites", None)).await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
    assert_eq!(anonymous.code(), "unauthorized");
}
