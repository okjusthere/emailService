using './main.bicep'

param environment = 'prod'
param deploymentTier = 'production'
param containerImage = 'REPLACE.azurecr.io/homix-marketing:REPLACE_GIT_SHA'
param acrName = 'REPLACE_ACR_NAME'
param entraTenantId = 'REPLACE_TENANT_ID'
param entraClientId = 'REPLACE_APP_CLIENT_ID'
param baseUrl = 'https://marketing.homixny.com'
param bootstrapAdminEmails = 'admin@homixny.com'
param companyPostalAddress = 'REPLACE_REAL_POSTAL_ADDRESS'
param alertEmail = 'REPLACE_ALERT_EMAIL'
param emailDeliveryMode = 'disabled'
param useResendSecrets = false
param useEntraClientSecret = false
param postgresSkuName = 'Standard_D2ds_v5'
param postgresTier = 'GeneralPurpose'
param postgresStorageSizeGb = 128
param enableZoneRedundantHa = false
param postgresBackupRetentionDays = 14
param enableGeoRedundantBackup = false
param storageSkuName = 'Standard_LRS'
