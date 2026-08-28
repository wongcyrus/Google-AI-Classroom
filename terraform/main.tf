terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

provider "google" {
  region = var.region
}

provider "google-beta" {
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

# Create Google Cloud Project from scratch and link billing
resource "google_project" "default" {
  count           = var.create_project ? 1 : 0
  name            = var.project_name
  project_id      = var.project_id
  billing_account = var.billing_account != "" ? var.billing_account : null
}

# Enable Firebase on the GCP Project
resource "google_firebase_project" "default" {
  provider = google-beta
  project  = var.project_id

  depends_on = [
    google_project.default,
    google_project_service.apis
  ]
}

data "google_project" "current" {
  project_id = var.project_id
  depends_on = [
    google_project.default,
    google_project_service.apis
  ]
}
