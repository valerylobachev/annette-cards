//! Push subscription request bodies (architecture.md §5.3).

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::error::AppError;

/// Longest accepted endpoint URL (Apple's and Google's are about 200 characters).
pub const MAX_ENDPOINT_CHARS: usize = 1000;

/// Hosts of the browsers' push services. The server only ever posts to these, so a subscription cannot point it at
/// another address.
const PUSH_SERVICE_HOSTS: [&str; 4] = [
    "push.apple.com",
    "fcm.googleapis.com",
    "push.services.mozilla.com",
    "notify.windows.com",
];

/// `PushSubscription.toJSON()` of the browser, without `expirationTime`.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PushSubscriptionDto {
    /// The push service URL of this browser.
    pub endpoint: String,
    pub keys: PushKeysDto,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PushKeysDto {
    /// P-256 public key of the browser, base64url (65 bytes).
    pub p256dh: String,
    /// Auth secret of the browser, base64url (16 bytes).
    pub auth: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct UnsubscribeRequest {
    pub endpoint: String,
}

impl PushSubscriptionDto {
    /// The subscription with its keys checked, or 400 `validation_failed`.
    pub fn validated(self) -> Result<Self, AppError> {
        let p256dh = decoded_len(&self.keys.p256dh);
        let auth = decoded_len(&self.keys.auth);
        if !is_push_service(&self.endpoint) || p256dh != Some(65) || auth != Some(16) {
            return Err(AppError::BadRequest("validation_failed"));
        }
        Ok(self)
    }
}

/// An `https` URL on a known push service host (or a subdomain of one).
pub fn is_push_service(endpoint: &str) -> bool {
    if endpoint.chars().count() > MAX_ENDPOINT_CHARS {
        return false;
    }
    let Ok(url) = reqwest::Url::parse(endpoint) else {
        return false;
    };
    let host = url.host_str().unwrap_or_default();
    url.scheme() == "https"
        && PUSH_SERVICE_HOSTS
            .iter()
            .any(|known| host == *known || host.ends_with(&format!(".{known}")))
}

/// Decodes base64url with or without padding (browsers differ).
pub fn decode_key(value: &str) -> Option<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(value.trim_end_matches('=')).ok()
}

fn decoded_len(value: &str) -> Option<usize> {
    decode_key(value).map(|bytes| bytes.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_push_services_are_accepted() {
        assert!(is_push_service("https://web.push.apple.com/QGuQyavXutnMH"));
        assert!(is_push_service("https://fcm.googleapis.com/fcm/send/abc"));
        assert!(is_push_service(
            "https://updates.push.services.mozilla.com/wpush/v2/x"
        ));
        assert!(!is_push_service("http://web.push.apple.com/x"));
        assert!(!is_push_service("https://evilpush.apple.com.example.org/x"));
        assert!(!is_push_service("https://127.0.0.1/x"));
        assert!(!is_push_service("not a url"));
    }

    #[test]
    fn keys_decode_with_or_without_padding() {
        assert_eq!(
            decode_key("AAAAAAAAAAAAAAAAAAAAAA").map(|k| k.len()),
            Some(16)
        );
        assert_eq!(
            decode_key("AAAAAAAAAAAAAAAAAAAAAA==").map(|k| k.len()),
            Some(16)
        );
        assert_eq!(decode_key("not base64!"), None);
    }
}
