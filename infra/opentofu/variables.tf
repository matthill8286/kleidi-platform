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

variable "image_tag" {
  type        = string
  description = "The release to run: the git SHA the deploy workflow built."
}

variable "app_hostname" {
  type        = string
  description = "Public hostname, such as app.kleidi.cy."
}

variable "firm_creators" {
  type        = list(string)
  description = "Emails allowed to create a firm: the pilot firms' admins."
  default     = []
}

variable "db_admin_password" {
  type      = string
  sensitive = true
}

variable "web_origin" {
  description = "The web app's public origin, allowed to upload to the documents bucket"
  type        = string
}

variable "db_app_password" {
  type      = string
  sensitive = true
}

variable "auth_secret" {
  type        = string
  sensitive   = true
  description = "Signs sessions. At least 32 random characters."
}

variable "s3_access_key" {
  type      = string
  sensitive = true
}

variable "s3_secret_key" {
  type      = string
  sensitive = true
}

variable "brevo_api_key" {
  type      = string
  sensitive = true
}
