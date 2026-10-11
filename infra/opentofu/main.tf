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
}

resource "scaleway_container_namespace" "kleidi" {
  name = "kleidi-${var.environment}"
}
