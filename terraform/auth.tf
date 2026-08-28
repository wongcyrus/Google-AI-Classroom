# Enable Identity Platform and Email / Password Sign-In
resource "google_identity_platform_config" "auth" {
  provider = google-beta
  project  = var.project_id

  sign_in {
    allow_duplicate_emails = false

    email {
      enabled           = true
      password_required = true
    }
  }

  authorized_domains = [
    "localhost",
    "127.0.0.1",
    "${var.project_id}.firebaseapp.com",
    "${var.project_id}.web.app"
  ]

  depends_on = [
    google_project_service.apis,
    google_firebase_project.default
  ]
}
