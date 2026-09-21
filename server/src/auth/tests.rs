//! Router tests for `/api/auth/*`.

use axum::http::StatusCode;
use serde_json::json;
use sqlx::SqlitePool;

use crate::test_support::{PASSWORD, create_user, get, login, post_json, send, test_app};

#[sqlx::test]
async fn login_sets_a_secure_session_cookie(pool: SqlitePool) {
    let user = create_user(&pool, "anna@example.com", false).await;
    let app = test_app(pool);

    let body =
        json!({ "email": "anna@example.com", "password": PASSWORD, "device_label": "iPhone" });
    let response = send(&app, post_json("/api/auth/login", &body, None)).await;

    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(response.body["id"], user.id);
    assert_eq!(response.body["email"], "anna@example.com");
    assert_eq!(response.body["is_admin"], false);
    let set_cookie = response.session_set_cookie().unwrap();
    for attribute in [
        "HttpOnly",
        "Secure",
        "SameSite=Strict",
        "Path=/",
        "Max-Age=7776000",
    ] {
        assert!(
            set_cookie.contains(attribute),
            "{attribute} missing in {set_cookie}"
        );
    }
}

#[sqlx::test]
async fn wrong_password_and_unknown_email_look_the_same(pool: SqlitePool) {
    create_user(&pool, "anna@example.com", false).await;
    let app = test_app(pool);

    for (email, password) in [
        ("anna@example.com", "wrong password!"),
        ("nobody@example.com", PASSWORD),
    ] {
        let body = json!({ "email": email, "password": password });
        let response = send(&app, post_json("/api/auth/login", &body, None)).await;
        assert_eq!(response.status, StatusCode::UNAUTHORIZED);
        assert_eq!(
            response.body,
            json!({ "code": "invalid_credentials", "details": null })
        );
        assert!(response.session_set_cookie().is_none());
    }
}

#[sqlx::test]
async fn email_match_is_case_insensitive(pool: SqlitePool) {
    create_user(&pool, "anna@example.com", false).await;
    let app = test_app(pool);
    login(&app, " Anna@Example.COM ", PASSWORD).await;
}

#[sqlx::test]
async fn me_requires_a_session(pool: SqlitePool) {
    create_user(&pool, "anna@example.com", true).await;
    let app = test_app(pool);

    let anonymous = send(&app, get("/api/auth/me", None)).await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        anonymous.body,
        json!({ "code": "unauthorized", "details": null })
    );
    let bogus = send(&app, get("/api/auth/me", Some("ac_session=bogus"))).await;
    assert_eq!(bogus.status, StatusCode::UNAUTHORIZED);

    let cookie = login(&app, "anna@example.com", PASSWORD).await;
    let me = send(&app, get("/api/auth/me", Some(&cookie))).await;
    assert_eq!(me.status, StatusCode::OK);
    assert_eq!(me.body["email"], "anna@example.com");
    assert_eq!(me.body["display_name"], "Test User");
    assert_eq!(me.body["is_admin"], true);
    assert!(me.body["created_at"].is_i64());
    // The sliding session is renewed in the browser too.
    assert_eq!(me.session_cookie(), cookie);
}

#[sqlx::test]
async fn logout_revokes_the_session_and_clears_the_cookie(pool: SqlitePool) {
    create_user(&pool, "anna@example.com", false).await;
    let app = test_app(pool);
    let cookie = login(&app, "anna@example.com", PASSWORD).await;

    let response = send(
        &app,
        post_json("/api/auth/logout", &json!({}), Some(&cookie)),
    )
    .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    let cleared = response.session_set_cookie().unwrap();
    assert!(cleared.starts_with("ac_session=;"), "{cleared}");
    assert!(cleared.contains("Max-Age=0"), "{cleared}");

    let me = send(&app, get("/api/auth/me", Some(&cookie))).await;
    assert_eq!(me.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn logout_others_keeps_only_the_calling_session(pool: SqlitePool) {
    create_user(&pool, "anna@example.com", false).await;
    let app = test_app(pool);
    let a = login(&app, "anna@example.com", PASSWORD).await;
    let b = login(&app, "anna@example.com", PASSWORD).await;

    let response = send(
        &app,
        post_json("/api/auth/logout-others", &json!({}), Some(&a)),
    )
    .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);

    assert_eq!(
        send(&app, get("/api/auth/me", Some(&a))).await.status,
        StatusCode::OK
    );
    assert_eq!(
        send(&app, get("/api/auth/me", Some(&b))).await.status,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test]
async fn change_password(pool: SqlitePool) {
    create_user(&pool, "anna@example.com", false).await;
    let app = test_app(pool);
    let a = login(&app, "anna@example.com", PASSWORD).await;
    let b = login(&app, "anna@example.com", PASSWORD).await;
    let change =
        |current: &str, new: &str| json!({ "current_password": current, "new_password": new });

    let wrong = send(
        &app,
        post_json(
            "/api/auth/password",
            &change("wrong password!", "new password 123"),
            Some(&a),
        ),
    )
    .await;
    assert_eq!(wrong.status, StatusCode::BAD_REQUEST);
    assert_eq!(wrong.code(), "invalid_credentials");

    let short = send(
        &app,
        post_json("/api/auth/password", &change(PASSWORD, "short"), Some(&a)),
    )
    .await;
    assert_eq!(short.status, StatusCode::BAD_REQUEST);
    assert_eq!(short.code(), "password_too_short");

    let ok = send(
        &app,
        post_json(
            "/api/auth/password",
            &change(PASSWORD, "new password 123"),
            Some(&a),
        ),
    )
    .await;
    assert_eq!(ok.status, StatusCode::NO_CONTENT);

    assert_eq!(
        send(&app, get("/api/auth/me", Some(&a))).await.status,
        StatusCode::OK
    );
    assert_eq!(
        send(&app, get("/api/auth/me", Some(&b))).await.status,
        StatusCode::UNAUTHORIZED
    );
    let old = json!({ "email": "anna@example.com", "password": PASSWORD });
    assert_eq!(
        send(&app, post_json("/api/auth/login", &old, None))
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    login(&app, "anna@example.com", "new password 123").await;
}

#[sqlx::test]
async fn auth_endpoints_are_in_the_openapi_spec(pool: SqlitePool) {
    let app = test_app(pool);
    let spec = send(&app, get("/api/openapi.json", None)).await.body;
    for path in ["login", "logout", "logout-others", "me", "password"] {
        assert!(
            spec["paths"][format!("/api/auth/{path}")].is_object(),
            "{path}"
        );
    }
    assert_eq!(
        spec["components"]["securitySchemes"]["session"]["in"],
        "cookie"
    );
    assert_eq!(
        spec["components"]["securitySchemes"]["session"]["name"],
        "ac_session"
    );
}

mod register {
    use super::*;
    use crate::{
        admin::invites,
        clock::{DAY_MS, now_ms},
    };

    async fn invite(pool: &SqlitePool, created_at: i64) -> String {
        let admin = create_user(pool, "admin@example.com", true).await;
        invites::create_invite(pool, &admin.id, Some("Anna"), 7, created_at)
            .await
            .unwrap()
            .code
    }

    fn body(code: &str, email: &str) -> serde_json::Value {
        json!({
            "invite_code": code,
            "display_name": "Anna",
            "email": email,
            "password": "anna's long password",
        })
    }

    async fn used_by(pool: &SqlitePool, code: &str) -> Option<String> {
        sqlx::query_scalar("SELECT used_by FROM invites WHERE code = ?")
            .bind(code)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[sqlx::test]
    async fn a_valid_invite_creates_a_signed_in_account(pool: SqlitePool) {
        let code = invite(&pool, now_ms()).await;
        let app = test_app(pool.clone());

        // Codes work in any letter case.
        let body = body(&code.to_lowercase(), "anna@example.com");
        let response = send(&app, post_json("/api/auth/register", &body, None)).await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.body);
        assert_eq!(response.body["email"], "anna@example.com");
        assert_eq!(response.body["display_name"], "Anna");
        assert_eq!(response.body["is_admin"], false);

        let cookie = response.session_cookie();
        let me = send(&app, get("/api/auth/me", Some(&cookie))).await;
        assert_eq!(me.body["id"], response.body["id"]);
        assert_eq!(
            used_by(&pool, &code).await.as_deref(),
            me.body["id"].as_str()
        );
    }

    #[sqlx::test]
    async fn an_invite_works_once(pool: SqlitePool) {
        let code = invite(&pool, now_ms()).await;
        let app = test_app(pool);
        let first = send(
            &app,
            post_json("/api/auth/register", &body(&code, "anna@example.com"), None),
        )
        .await;
        assert_eq!(first.status, StatusCode::OK);

        let again = send(
            &app,
            post_json("/api/auth/register", &body(&code, "bob@example.com"), None),
        )
        .await;
        assert_eq!(again.status, StatusCode::BAD_REQUEST);
        assert_eq!(again.code(), "invite_invalid");
    }

    #[sqlx::test]
    async fn unknown_and_expired_invites_are_rejected(pool: SqlitePool) {
        let expired = invite(&pool, now_ms() - 8 * DAY_MS).await;
        let app = test_app(pool);

        let unknown = send(
            &app,
            post_json(
                "/api/auth/register",
                &body("NOPE23456789", "a@example.com"),
                None,
            ),
        )
        .await;
        assert_eq!(unknown.status, StatusCode::BAD_REQUEST);
        assert_eq!(unknown.code(), "invite_invalid");

        let late = send(
            &app,
            post_json("/api/auth/register", &body(&expired, "a@example.com"), None),
        )
        .await;
        assert_eq!(late.status, StatusCode::BAD_REQUEST);
        assert_eq!(late.code(), "invite_expired");
    }

    #[sqlx::test]
    async fn a_taken_email_leaves_the_invite_unused(pool: SqlitePool) {
        let code = invite(&pool, now_ms()).await;
        create_user(&pool, "anna@example.com", false).await;
        let app = test_app(pool.clone());

        let taken = send(
            &app,
            post_json("/api/auth/register", &body(&code, "ANNA@example.com"), None),
        )
        .await;
        assert_eq!(taken.status, StatusCode::CONFLICT);
        assert_eq!(taken.code(), "email_taken");
        assert!(taken.session_set_cookie().is_none());
        // The transaction rolled back: the invite still works for another email.
        assert_eq!(used_by(&pool, &code).await, None);
        let retry = send(
            &app,
            post_json(
                "/api/auth/register",
                &body(&code, "anna2@example.com"),
                None,
            ),
        )
        .await;
        assert_eq!(retry.status, StatusCode::OK);
    }

    #[sqlx::test]
    async fn invalid_account_details_are_rejected(pool: SqlitePool) {
        let code = invite(&pool, now_ms()).await;
        let app = test_app(pool.clone());
        let cases = [
            ("password", json!("short"), "password_too_short"),
            ("display_name", json!("   "), "validation_failed"),
            ("display_name", json!("x".repeat(101)), "validation_failed"),
            ("email", json!("not-an-email"), "validation_failed"),
        ];
        for (field, value, code_expected) in cases {
            let mut request = body(&code, "anna@example.com");
            request[field] = value;
            let response = send(&app, post_json("/api/auth/register", &request, None)).await;
            assert_eq!(response.status, StatusCode::BAD_REQUEST, "{field}");
            assert_eq!(response.code(), code_expected, "{field}");
        }
        assert_eq!(used_by(&pool, &code).await, None);
    }
}

/// The whole account lifecycle through the API, starting from the CLI's service functions.
#[sqlx::test]
async fn full_account_flow(pool: SqlitePool) {
    create_user(&pool, "admin@example.com", true).await;
    let app = test_app(pool);
    let admin = login(&app, "admin@example.com", PASSWORD).await;

    let invite = send(
        &app,
        post_json(
            "/api/admin/invites",
            &json!({ "note": "Anna" }),
            Some(&admin),
        ),
    )
    .await;
    assert_eq!(invite.status, StatusCode::CREATED);
    let code = invite.body["code"].as_str().unwrap();

    let body = json!({
        "invite_code": code,
        "display_name": "Anna",
        "email": "anna@example.com",
        "password": "anna's long password",
        "device_label": "iPhone",
    });
    let registered = send(&app, post_json("/api/auth/register", &body, None)).await;
    assert_eq!(registered.status, StatusCode::OK);
    let phone = registered.session_cookie();
    let laptop = login(&app, "anna@example.com", "anna's long password").await;

    let me = send(&app, get("/api/auth/me", Some(&phone))).await;
    assert_eq!(me.body["email"], "anna@example.com");

    let others = send(
        &app,
        post_json("/api/auth/logout-others", &json!({}), Some(&phone)),
    )
    .await;
    assert_eq!(others.status, StatusCode::NO_CONTENT);
    assert_eq!(
        send(&app, get("/api/auth/me", Some(&laptop))).await.status,
        StatusCode::UNAUTHORIZED
    );

    let change = json!({ "current_password": "anna's long password", "new_password": "a brand new password" });
    let changed = send(&app, post_json("/api/auth/password", &change, Some(&phone))).await;
    assert_eq!(changed.status, StatusCode::NO_CONTENT);

    let logout = send(
        &app,
        post_json("/api/auth/logout", &json!({}), Some(&phone)),
    )
    .await;
    assert_eq!(logout.status, StatusCode::NO_CONTENT);
    assert_eq!(
        send(&app, get("/api/auth/me", Some(&phone))).await.status,
        StatusCode::UNAUTHORIZED
    );
    login(&app, "anna@example.com", "a brand new password").await;

    let invites = send(&app, get("/api/admin/invites", Some(&admin))).await;
    assert_eq!(invites.body[0]["status"], "used");
    assert_eq!(invites.body[0]["used_by_email"], "anna@example.com");
}
