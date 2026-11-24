variable "TAG" {
  default = "local"
}

group "default" {
  targets = ["nestcloud"]
}

target "nestcloud" {
  context    = ".."
  dockerfile = "NestCloud/Dockerfile"
  tags       = ["solacloud/nestcloud:${TAG}"]
}
