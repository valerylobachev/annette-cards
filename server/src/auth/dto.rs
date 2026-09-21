use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::auth::extractor::CurrentUser;

#[derive(Debug, Deserialize, ToSchema)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
    /// Shown in the list of sessions, e.g. "iPhone Safari".
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
