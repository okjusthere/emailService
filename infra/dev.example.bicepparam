using './main.bicep'

param environment = 'dev'
param deploymentTier = 'starter'
param containerImage = 'REPLACE.azurecr.io/homix-marketing:REPLACE_GIT_SHA'
param acrName = 'REPLACE_ACR_NAME'
param entraTenantId = 'REPLACE_TENANT_ID'
param entraClientId = 'REPLACE_APP_CLIENT_ID'
param baseUrl = 'https://REPLACE_CONTAINER_APP_FQDN'
param bootstrapAdminEmails = 'admin@homixny.com'
param emailDeliveryMode = 'disabled'
param useResendSecrets = false
param useEntraClientSecret = false
param enableZoneRedundantHa = false
param enableGeoRedundantBackup = false
param storageSkuName = 'Standard_LRS'
