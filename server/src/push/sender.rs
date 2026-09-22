//! The real sender: encrypts the payload for the browser (RFC 8291, `aes128gcm`), signs a VAPID token (RFC 8292)
//! with the server's private key and posts the message to the browser's push service.

use std::time::Duration;

use anyhow::{Context, bail};
use async_trait::async_trait;
use axum::http::{StatusCode, Uri};
use web_push_native::{
    Auth, WebPushBuilder,
    jwt_simple::algorithms::{ECDSAP256PublicKeyLike, ES256KeyPair},
    p256::PublicKey,
};

use crate::push::{Delivery, PushError, PushSender, Subscription, dto::decode_key};

/// How long the push service keeps an undelivered reminder (the phone may be off); after that it is stale.
const MESSAGE_TTL: Duration = Duration::from_secs(60 * 60);

pub struct WebPushSender {
    http: reqwest::Client,
    key_pair: ES256KeyPair,
    /// The VAPID `sub` claim: how the push service can reach the operator (`https:` or `mailto:`).
    contact: String,
}

impl WebPushSender {
    /// Checks that the private key is a P-256 key and that the configured public key is its own (the browser
    /// subscribes with the public key, the server signs with the private one, so a mismatch fails every send).
    pub fn new(
        http: reqwest::Client,
        public_key: &str,
        private_key: &str,
        contact: String,
    ) -> anyhow::Result<Self> {
        let private =
            decode_key(private_key).context("ANNETTE_VAPID_PRIVATE_KEY is not base64url")?;
        let key_pair = ES256KeyPair::from_bytes(&private)
            .map_err(|_| anyhow::anyhow!("ANNETTE_VAPID_PRIVATE_KEY is not a P-256 private key"))?;
        let derived = key_pair.public_key().public_key().to_bytes_uncompressed();
        if decode_key(public_key) != Some(derived) {
            bail!("ANNETTE_VAPID_PUBLIC_KEY does not belong to ANNETTE_VAPID_PRIVATE_KEY");
        }
        Ok(Self {
            http,
            key_pair,
            contact,
        })
    }

    fn build(
        &self,
        subscription: &Subscription,
        payload: &[u8],
    ) -> Result<reqwest::Request, PushError> {
        let invalid = |what: &str| PushError::InvalidSubscription(what.to_string());
        let endpoint: Uri = subscription
            .endpoint
            .parse()
            .map_err(|_| invalid("endpoint"))?;
        let p256dh = decode_key(&subscription.p256dh)
            .and_then(|bytes| PublicKey::from_sec1_bytes(&bytes).ok())
            .ok_or_else(|| invalid("p256dh"))?;
        let auth: [u8; 16] = decode_key(&subscription.auth)
            .and_then(|bytes| bytes.try_into().ok())
            .ok_or_else(|| invalid("auth"))?;
        let request = WebPushBuilder::new(endpoint, p256dh, Auth::from(auth))
            .with_valid_duration(MESSAGE_TTL)
            .with_vapid(&self.key_pair, &self.contact)
            .build(payload.to_vec())
            .map_err(|err| PushError::Service(err.to_string()))?;
        reqwest::Request::try_from(request).map_err(|err| PushError::Service(err.to_string()))
    }
}

#[async_trait]
impl PushSender for WebPushSender {
    async fn send(
        &self,
        subscription: &Subscription,
        payload: &[u8],
    ) -> Result<Delivery, PushError> {
        let request = self.build(subscription, payload)?;
        let response = self
            .http
            .execute(request)
            .await
            .map_err(|err| PushError::Service(err.to_string()))?;
        match response.status() {
            status if status.is_success() => Ok(Delivery::Accepted),
            StatusCode::NOT_FOUND | StatusCode::GONE => Ok(Delivery::Gone),
            status => Err(PushError::Service(format!("status {status}"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway key pair made for these tests (never used on a server).
    const PUBLIC: &str =
        "BOybS5X7a6I4xgXcfKoeQFoAJLi1DbYqUsLUi_RC5Vol7Wry68XfmT8fPAEo4bMabxjLF7OhKq5VchiAM42gd2Q";
    const PRIVATE: &str = "VU-4yVVA5nRzEbOQYGtjdl5U04oahrSGOBFF1chYiLQ";
    const P256DH: &str =
        "BLn9b-VR0ca83knDNZ32dCHGyjJp-1riX9ZTN40MqV8K_LpQmLqxC_DoHvqvFXO_nGdAB4W9dogZb_sM-uV4JbY";

    fn sender() -> anyhow::Result<WebPushSender> {
        WebPushSender::new(
            reqwest::Client::new(),
            PUBLIC,
            PRIVATE,
            "mailto:owner@example.com".into(),
        )
    }

    #[test]
    fn the_public_key_must_match_the_private_key() {
        assert!(sender().is_ok());
        let other = WebPushSender::new(reqwest::Client::new(), P256DH, PRIVATE, String::new());
        assert!(other.is_err());
        assert!(
            WebPushSender::new(reqwest::Client::new(), PUBLIC, "short", String::new()).is_err()
        );
    }

    #[test]
    fn a_message_is_encrypted_and_signed() {
        let subscription = Subscription {
            id: "s1".into(),
            endpoint: "https://web.push.apple.com/abc".into(),
            p256dh: P256DH.into(),
            auth: "_ordMnz7uTCmrpBTeUV4Bw".into(),
        };
        let request = sender()
            .unwrap()
            .build(&subscription, br#"{"type":"reminder","due":3}"#)
            .unwrap();
        assert_eq!(request.method(), "POST");
        assert_eq!(request.url().as_str(), "https://web.push.apple.com/abc");
        let headers = request.headers();
        assert_eq!(headers["content-encoding"], "aes128gcm");
        assert_eq!(headers["ttl"], "3600");
        let authorization = headers["authorization"].to_str().unwrap();
        assert!(authorization.starts_with("vapid t="), "{authorization}");
        assert!(
            authorization.ends_with(&format!("k={PUBLIC}")),
            "{authorization}"
        );
        let body = request.body().and_then(|body| body.as_bytes()).unwrap();
        assert!(
            !body.windows(8).any(|w| w == b"reminder"),
            "the payload is encrypted"
        );
    }
}
