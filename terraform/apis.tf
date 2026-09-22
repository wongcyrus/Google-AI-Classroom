locals {
  services = [
    "serviceusage.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "firebase.googleapis.com",
    "firestore.googleapis.com",
    "firebasestorage.googleapis.com",
    "identitytoolkit.googleapis.com",
    "cloudfunctions.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "run.googleapis.com",
    "eventarc.googleapis.com",
    "pubsub.googleapis.com",
    "cloudscheduler.googleapis.com",
    "firebaseextensions.googleapis.com",
    "aiplatform.googleapis.com",
    "generativelanguage.googleapis.com",
    "firebasevertexai.googleapis.com",
    "firebaseappcheck.googleapis.com",
    "firebaseml.googleapis.com",
    "recaptchaenterprise.googleapis.com",
    "appengine.googleapis.com",
    "cloudbilling.googleapis.com",
    "bigquery.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "cloudtasks.googleapis.com",
    "drive.googleapis.com"
  ]
}

resource "google_project_service" "apis" {
  for_each                   = toset(local.services)
  project                    = var.project_id
  service                    = each.key
  disable_dependent_services = false
  disable_on_destroy         = false

  depends_on = [
    google_project.default
  ]
}
