variable "project_id" {
  type        = string
  description = "The Google Cloud / Firebase Project ID"
}

variable "project_name" {
  type        = string
  description = "Display name for the project"
  default     = "Classroom Assistant"
}

variable "create_project" {
  type        = bool
  description = "Whether to create a new GCP project from scratch in Terraform"
  default     = true
}

variable "billing_account" {
  type        = string
  description = "Google Cloud Billing Account ID (e.g. 01C74C-667DFE-538DBC)"
  default     = "01C74C-667DFE-538DBC"
}

variable "region" {
  type        = string
  description = "Primary region for Firestore, Functions, and Storage"
  default     = "asia-east2"
}

variable "web_app_name" {
  type        = string
  description = "Display name for the Firebase Web App"
  default     = "CDCA Web App"
}

variable "recaptcha_site_key" {
  type        = string
  description = "reCAPTCHA v3 site key for frontend"
  default     = "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"
}
