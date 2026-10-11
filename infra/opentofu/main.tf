# Skeleton only: not yet applied or validated. Check resource arguments against the
# Scaleway provider docs before the first `tofu plan`.
terraform {
  required_version = ">= 1.8"
  required_providers {
    scaleway = {
      source  = "scaleway/scaleway"
      version = "~> 2.0"
    }
  }
}

provider "scaleway" {
  region     = var.region
  zone       = "${var.region}-1"
  project_id = var.project_id
}

resource "scaleway_registry_namespace" "kleidi" {
  name      = "kleidi-${var.environment}"
  is_public = false
}

resource "scaleway_rdb_instance" "kleidi" {
  name           = "kleidi-${var.environment}"
  node_type      = var.db_node_type
  engine         = var.db_engine
  is_ha_cluster  = var.environment == "prod"
  disable_backup = false
  user_name      = "kleidi_admin"
  password       = var.db_admin_password
}

resource "scaleway_object_bucket" "documents" {
  name = "kleidi-documents-${var.environment}"
  versioning {
    enabled = true
  }

  # Browsers upload straight to the bucket with signed links, so the web origin needs PUT.
  cors_rule {
    allowed_origins = [var.web_origin]
    allowed_methods = ["PUT", "GET"]
    allowed_headers = ["content-type"]
    max_age_seconds = 3600
  }

  # Uploads that were never confirmed, and quarantined files, are removed after 30 days.
  lifecycle_rule {
    id      = "expire-quarantine"
    prefix  = "quarantine/"
    enabled = true
    expiration {
      days = 30
    }
  }
}

resource "scaleway_container_namespace" "kleidi" {
  name = "kleidi-${var.environment}"
}
