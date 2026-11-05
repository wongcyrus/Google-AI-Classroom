# Secret Manager Configuration for Classroom Assistant Backend

# Secret resource for SMTP credentials (container only; payload managed via Firebase CLI / Secret Manager)
resource "google_secret_manager_secret" "smtp_password" {
  secret_id = "SMTP_PASSWORD"
  project   = var.project_id

  replication {
    auto {}
  }

  labels = {
    service   = "classroom-assistant"
    component = "smtp-mailer"
  }

  depends_on = [
    google_project_service.apis
  ]
}

# Grant Cloud Functions Gen 2 / Cloud Run default service account permission to access the secret
resource "google_secret_manager_secret_iam_member" "functions_smtp_access" {
  secret_id = google_secret_manager_secret.smtp_password.secret_id
  project   = var.project_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${data.google_project.current.number}-compute@developer.gserviceaccount.com"

  depends_on = [
    google_secret_manager_secret.smtp_password
  ]
}
