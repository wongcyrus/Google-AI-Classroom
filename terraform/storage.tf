# Initialize default Firebase Storage bucket via Firebase Storage API
resource "null_resource" "init_firebase_storage_default_bucket" {
  provisioner "local-exec" {
    command = <<-EOT
      curl -s -X POST "https://firebasestorage.googleapis.com/v1beta/projects/${var.project_id}/defaultBucket" \
        -H "Authorization: Bearer $(gcloud auth print-access-token)" \
        -H "Content-Type: application/json" \
        -d '{"location": "${var.region}"}' || true
    EOT
  }

  depends_on = [
    google_project_service.apis,
    google_firebase_project.default
  ]
}

# Configure CORS on the default Firebase Storage bucket automatically
resource "null_resource" "configure_firebase_storage_cors" {
  triggers = {
    cors_hash  = local_file.storage_cors.content_sha256
    project_id = var.project_id
  }

  provisioner "local-exec" {
    command = <<-EOT
      curl -s -f -X PATCH "https://storage.googleapis.com/storage/v1/b/${var.project_id}.firebasestorage.app" \
        -H "Authorization: Bearer $(gcloud auth print-access-token)" \
        -H "Content-Type: application/json" \
        -d "{\"cors\": $(cat ${local_file.storage_cors.filename})}" || true
    EOT
  }

  depends_on = [
    null_resource.init_firebase_storage_default_bucket,
    local_file.storage_cors
  ]
}

# Pre-create Cloud Functions v2 source staging bucket in regional location
resource "google_storage_bucket" "gcf_v2_sources" {
  name                        = "gcf-v2-sources-${data.google_project.current.number}-${var.region}"
  project                     = var.project_id
  location                    = var.region
  uniform_bucket_level_access = true
  lifecycle {
    ignore_changes = all
  }

  depends_on = [
    google_project_service.apis,
    google_firebase_project.default
  ]
}
