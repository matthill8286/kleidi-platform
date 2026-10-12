# Kleidi on Scaleway (EU, fr-par): managed Postgres, a private object bucket, and three
# serverless pieces built from one Dockerfile: api (also serves the web app), worker (with
# ClamAV inside) and a migrate job run once per release. Validated with `tofu validate`;
# not yet applied.
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
  name               = "kleidi-${var.environment}"
  node_type          = var.db_node_type
  engine             = var.db_engine
  is_ha_cluster      = var.environment == "prod"
  user_name          = "kleidi_admin"
  password           = var.db_admin_password
  encryption_at_rest = true

  # Daily backups kept for two weeks; the restore drill in infra/scripts proves they work.
  disable_backup            = false
  backup_schedule_frequency = 24
  backup_schedule_retention = 14

  # Public endpoint over TLS; move to a private network before taking on more firms.
  load_balancer {}
}

resource "scaleway_rdb_database" "kleidi" {
  instance_id = scaleway_rdb_instance.kleidi.id
  name        = "kleidi"
}

# The app connects as this non-owner role, so row-level security applies to it.
resource "scaleway_rdb_user" "app" {
  instance_id = scaleway_rdb_instance.kleidi.id
  name        = "kleidi_app"
  password    = var.db_app_password
  is_admin    = false
}

resource "scaleway_rdb_privilege" "app" {
  instance_id   = scaleway_rdb_instance.kleidi.id
  user_name     = scaleway_rdb_user.app.name
  database_name = scaleway_rdb_database.kleidi.name
  permission    = "custom"
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

locals {
  registry    = scaleway_registry_namespace.kleidi.endpoint
  db_host     = scaleway_rdb_instance.kleidi.load_balancer[0].ip
  db_port     = scaleway_rdb_instance.kleidi.load_balancer[0].port
  db_app_url  = "postgres://kleidi_app:${var.db_app_password}@${local.db_host}:${local.db_port}/kleidi?sslmode=require"
  db_admin    = "postgres://kleidi_admin:${var.db_admin_password}@${local.db_host}:${local.db_port}/kleidi?sslmode=require"
  s3_endpoint = "https://s3.${var.region}.scw.cloud"

  shared_env = {
    NODE_ENV    = "production"
    WEB_ORIGIN  = var.web_origin
    S3_ENDPOINT = local.s3_endpoint
    S3_REGION   = var.region
    S3_BUCKET   = scaleway_object_bucket.documents.name
    MAIL_FROM   = "Kleidi <no-reply@kleidi.cy>"
  }
  shared_secrets = {
    DATABASE_URL  = local.db_app_url
    S3_ACCESS_KEY = var.s3_access_key
    S3_SECRET_KEY = var.s3_secret_key
    BREVO_API_KEY = var.brevo_api_key
  }
}

resource "scaleway_container" "api" {
  name                   = "api"
  namespace_id           = scaleway_container_namespace.kleidi.id
  registry_image         = "${local.registry}/api:${var.image_tag}"
  port                   = 8080
  cpu_limit              = 1000
  memory_limit_bytes     = 1073741824 # 1 GB
  min_scale              = 1
  max_scale              = 4
  privacy                = "public"
  protocol               = "http1"
  https_connections_only = true

  environment_variables = merge(local.shared_env, {
    S3_PUBLIC_ENDPOINT = "https://${scaleway_object_bucket.documents.name}.s3.${var.region}.scw.cloud"
    # Serverless containers sit behind exactly one proxy.
    TRUSTED_PROXIES = "1"
    FIRM_CREATORS   = join(",", var.firm_creators)
  })
  secret_environment_variables = merge(local.shared_secrets, {
    BETTER_AUTH_SECRET = var.auth_secret
  })
}

resource "scaleway_container_domain" "app" {
  container_id = scaleway_container.api.id
  hostname     = var.app_hostname
}

# One instance only: it relays the outbox and runs the scheduled jobs.
resource "scaleway_container" "worker" {
  name               = "worker"
  namespace_id       = scaleway_container_namespace.kleidi.id
  registry_image     = "${local.registry}/worker:${var.image_tag}"
  port               = 8080
  cpu_limit          = 1000
  memory_limit_bytes = 2147483648 # 2 GB: ClamAV keeps its signatures in memory
  min_scale          = 1
  max_scale          = 1
  privacy            = "private"

  environment_variables        = local.shared_env
  secret_environment_variables = local.shared_secrets
}

# Applies migrations and policies; the deploy workflow runs it before rolling out a release.
resource "scaleway_job_definition" "migrate" {
  name                   = "kleidi-${var.environment}-migrate"
  cpu_limit              = 500
  memory_limit           = 512
  image_uri              = "${local.registry}/migrate:${var.image_tag}"
  timeout                = "10m"
  local_storage_capacity = 1000
  env = {
    DATABASE_ADMIN_URL = local.db_admin
  }
}
