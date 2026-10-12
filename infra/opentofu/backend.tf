# State is kept in a private Scaleway bucket (create it once by hand: kleidi-tofu-state) and
# encrypted by OpenTofu with the key in TF_ENCRYPTION, because it holds the secrets above.
terraform {
  backend "s3" {
    bucket                      = "kleidi-tofu-state"
    key                         = "kleidi.tfstate"
    region                      = "fr-par"
    endpoints                   = { s3 = "https://s3.fr-par.scw.cloud" }
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
  }
}
