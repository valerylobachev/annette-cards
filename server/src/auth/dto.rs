use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::auth::{extractor::CurrentUser, users::User};

#[derive(Debug, Deserialize, ToSchema)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
    /// Shown in the list of sessions, e.g. "iPhone Safari".
    pub device_label: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RegisterRequest {
    /// The 12-character code from the invite link; letter case does not matter.
    pub invite_code: String,
    pub display_name: String,
    pub email: String,
    pub password: String,
    pub device_label: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

/// The signed-in user.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct MeResponse {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub is_admin: bool,
    pub created_at: i64,
}

impl From<User> for MeResponse {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            email: user.email,
            display_name: user.display_name,
            is_admin: user.is_admin,
            created_at: user.created_at,
        }
    }
}

impl From<CurrentUser> for MeResponse {
    fn from(user: CurrentUser) -> Self {
        Self {
            id: user.user_id,
            email: user.email,
            display_name: user.display_name,
            is_admin: user.is_admin,
            created_at: user.created_at,
        }
    }
}
