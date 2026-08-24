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
param emailTestAllowlist = 'admin@homixny.com'
param useResendSecrets = false
param usePreviousUnsubscribeSigningSecret = false
param oneKeyProvider = 'disabled'
param bboListingApiBaseUrl = ''
param useBboMarketingApiKey = false
param useMlsGridAccessToken = false
param oneKeySyncEnabled = false
param aiProvider = 'disabled'
param useOpenAiApiKey = false
param openAiModel = 'gpt-5-mini'
param useEntraClientSecret = false
param enableZoneRedundantHa = false
param enableGeoRedundantBackup = false
param storageSkuName = 'Standard_LRS'
