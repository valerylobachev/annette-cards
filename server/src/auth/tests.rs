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
