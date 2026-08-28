output "project_id" {
  value       = var.project_id
  description = "Firebase Project ID"
}

output "project_number" {
  value       = data.google_project.current.number
  description = "Google Cloud Project Number"
}

output "hosting_url" {
  value       = "https://${var.project_id}.web.app"
  description = "Default Firebase Hosting URL"
}

output "firebase_console_url" {
  value       = "https://console.firebase.google.com/project/${var.project_id}/overview"
  description = "Firebase Console URL"
}

output "storage_bucket" {
  value       = "gs://${var.project_id}.firebasestorage.app"
  description = "Firebase Default Storage Bucket"
}
