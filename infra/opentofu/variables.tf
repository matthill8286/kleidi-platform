variable "project_id" {
  type        = string
  description = "Scaleway project ID."
}

variable "environment" {
  type        = string
  description = "dev, staging or prod."
}

variable "region" {
  type    = string
  default = "fr-par"
}

variable "db_node_type" {
  type    = string
  default = "DB-DEV-S"
}

variable "db_engine" {
  type    = string
  default = "PostgreSQL-16"
}

variable "db_admin_password" {
  type      = string
  sensitive = true
}
