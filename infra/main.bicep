targetScope = 'resourceGroup'

@description('Immutable image reference, normally ACR login server plus a Git SHA tag.')
param containerImage string
@description('Optional current web image used to keep Web unchanged while the migration job is upgraded.')
param webContainerImage string = containerImage
@description('Optional current worker image used to keep Worker unchanged while the migration job is upgraded.')
param workerContainerImage string = containerImage
@description('Migration image; normally the new immutable release image.')
param migrationContainerImage string = containerImage
@allowed(['dev', 'prod'])
param environment string
@allowed(['starter', 'production'])
param deploymentTier string = 'starter'
param location string = resourceGroup().location
param acrName string
param uniqueSuffix string = take(uniqueString(subscription().id, resourceGroup().id), 8)
param postgresAdminLogin string = 'homixadmin'
@secure()
param postgresAdminPassword string = ''
param entraTenantId string
param entraClientId string
@secure()
param entraClientSecret string = ''
@secure()
param resendApiKey string = ''
@secure()
param resendWebhookSecret string = ''
@secure()
param unsubscribeSigningSecret string = ''
@secure()
param unsubscribePreviousSigningSecret string = ''
param usePreviousUnsubscribeSigningSecret bool = false
@secure()
param bboMarketingApiKey string = ''
param useBboMarketingApiKey bool = false
@secure()
param mlsGridAccessToken string = ''
param useMlsGridAccessToken bool = false
@secure()
param openAiApiKey string = ''
param useOpenAiApiKey bool = false
param useResendSecrets bool = false
param usePreviousResendWebhookSecret bool = false
@secure()
param resendWebhookPreviousSecretExpiresAt string = ''
@secure()
param unsubscribePreviousSigningSecretExpiresAt string = ''
param useEntraClientSecret bool = false
@allowed(['disabled', 'sandbox', 'live'])
param emailDeliveryMode string = 'disabled'
@description('Comma-separated normalized recipient addresses allowed while delivery is in sandbox mode.')
param emailTestAllowlist string = ''
param baseUrl string
@description('Optional Container App custom domain. Leave empty until DNS validation records exist.')
param customDomainName string = ''
@description('Managed certificate resource name for customDomainName. Required when customDomainName is set.')
param customDomainManagedCertificateName string = ''
@allowed(['disabled', 'bbo', 'fake'])
param oneKeyProvider string = 'disabled'
param bboListingApiBaseUrl string = ''
@description('Comma-separated exact origins approved for BBO-hosted listing media. No wildcards or paths.')
param oneKeyMediaAllowedOrigins string = ''
param oneKeySyncEnabled bool = false
@allowed(['disabled', 'openai', 'azure-openai', 'fake'])
param aiProvider string = 'disabled'
param openAiModel string = 'gpt-5-mini'
param openAiBaseUrl string = 'https://api.openai.com/v1'
param bootstrapAdminEmails string
param companyPostalAddress string = 'REQUIRED_BEFORE_LIVE_SEND'
param alertEmail string = ''
param postgresSkuName string = deploymentTier == 'production' ? 'Standard_D2ds_v5' : 'Standard_B1ms'
param postgresTier string = deploymentTier == 'production' ? 'GeneralPurpose' : 'Burstable'
param postgresStorageSizeGb int = deploymentTier == 'production' ? 128 : 32
param enableZoneRedundantHa bool = false
@minValue(7)
@maxValue(35)
param postgresBackupRetentionDays int = deploymentTier == 'production' ? 14 : 7
param enableGeoRedundantBackup bool = false
@allowed(['Standard_LRS', 'Standard_GRS', 'Standard_ZRS'])
param storageSkuName string = 'Standard_LRS'
param vnetAddressPrefix string = '10.42.0.0/16'
param containerAppsSubnetPrefix string = '10.42.0.0/23'
param postgresSubnetPrefix string = '10.42.2.0/24'
param privateEndpointsSubnetPrefix string = '10.42.3.0/24'
param webMinReplicas int = 1
param webMaxReplicas int = deploymentTier == 'production' ? 3 : 2
param workerMinReplicas int = 1
param workerMaxReplicas int = 1

var postgresHaMode = enableZoneRedundantHa ? 'ZoneRedundant' : 'Disabled'

var namePrefix = 'homix-mkt-${environment}'
var tags = {
  application: 'homix-marketing'
  environment: environment
  owner: 'homix-group'
  managedBy: 'bicep'
  dataClassification: 'internal'
}
var publicAssetTags = union(tags, { dataClassification: 'public-marketing-assets' })
var databaseName = 'homix_marketing'
var postgresHost = '${postgres.name}.postgres.database.azure.com'
var postgresRuntimeUrl = 'postgresql://${postgresAdminLogin}:${uriComponent(postgresAdminPassword)}@${postgresHost}:5432/${databaseName}?schema=public&sslmode=require&connection_limit=5&pool_timeout=20'
var postgresDirectUrl = 'postgresql://${postgresAdminLogin}:${uriComponent(postgresAdminPassword)}@${postgresHost}:5432/${databaseName}?schema=public&sslmode=require&connection_limit=2&pool_timeout=30'
var publicPaths = [
  '/health/live'
  '/health/ready'
  '/api/public/webhooks/resend'
  '/api/public/unsubscribe/*'
  '/unsubscribe'
  '/public/assets/*'
]
var commonSecrets = concat([
  { name: 'database-url', keyVaultUrl: '${vault.properties.vaultUri}secrets/postgres-runtime-url', identity: identity.id }
  { name: 'direct-database-url', keyVaultUrl: '${vault.properties.vaultUri}secrets/postgres-direct-url', identity: identity.id }
  { name: 'session-secret', keyVaultUrl: '${vault.properties.vaultUri}secrets/session-secret', identity: identity.id }
  { name: 'unsubscribe-signing-secret', keyVaultUrl: '${vault.properties.vaultUri}secrets/unsubscribe-signing-secret', identity: identity.id }
], useResendSecrets ? [
  { name: 'resend-api-key', keyVaultUrl: '${vault.properties.vaultUri}secrets/resend-api-key', identity: identity.id }
  { name: 'resend-webhook-secret', keyVaultUrl: '${vault.properties.vaultUri}secrets/resend-webhook-secret', identity: identity.id }
] : [], usePreviousResendWebhookSecret ? [
  { name: 'resend-webhook-previous-secret', keyVaultUrl: '${vault.properties.vaultUri}secrets/resend-webhook-previous-secret', identity: identity.id }
] : [], usePreviousUnsubscribeSigningSecret ? [
  { name: 'unsubscribe-previous-signing-secret', keyVaultUrl: '${vault.properties.vaultUri}secrets/unsubscribe-previous-signing-secret', identity: identity.id }
] : [], useBboMarketingApiKey ? [
  { name: 'bbo-marketing-api-key', keyVaultUrl: '${vault.properties.vaultUri}secrets/bbo-marketing-api-key', identity: identity.id }
] : [], useMlsGridAccessToken ? [
  { name: 'mls-grid-access-token', keyVaultUrl: '${vault.properties.vaultUri}secrets/mls-grid-access-token', identity: identity.id }
] : [], useOpenAiApiKey ? [
  { name: 'openai-api-key', keyVaultUrl: '${vault.properties.vaultUri}secrets/openai-api-key', identity: identity.id }
] : [], useEntraClientSecret ? [{ name: 'entra-client-secret', keyVaultUrl: '${vault.properties.vaultUri}secrets/entra-client-secret', identity: identity.id }] : [])
var commonEnv = concat([
  { name: 'NODE_ENV', value: 'production' }
  { name: 'PORT', value: '3000' }
  { name: 'BASE_URL', value: baseUrl }
  { name: 'DEFAULT_TIMEZONE', value: 'America/New_York' }
  { name: 'DATABASE_URL', secretRef: 'database-url' }
  { name: 'DIRECT_DATABASE_URL', secretRef: 'direct-database-url' }
  { name: 'SESSION_SECRET', secretRef: 'session-secret' }
  { name: 'UNSUBSCRIBE_SIGNING_SECRET', secretRef: 'unsubscribe-signing-secret' }
  { name: 'AUTH_MODE', value: 'azure-easyauth' }
  { name: 'BOOTSTRAP_ADMIN_EMAILS', value: bootstrapAdminEmails }
  { name: 'AUTO_PROVISION_USERS', value: 'false' }
  { name: 'ALLOWED_EMAIL_DOMAINS', value: 'homixny.com' }
  { name: 'DEV_BYPASS_AUTH', value: 'false' }
  { name: 'EMAIL_PROVIDER', value: 'resend' }
  { name: 'EMAIL_DELIVERY_MODE', value: emailDeliveryMode }
  { name: 'EMAIL_TEST_ALLOWLIST', value: emailTestAllowlist }
  { name: 'STORAGE_PROVIDER', value: 'azure' }
  { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
  { name: 'AZURE_STORAGE_ACCOUNT_URL', value: 'https://${storage.name}.blob.${az.environment().suffixes.storage}' }
  { name: 'AZURE_STORAGE_CONTAINER', value: 'marketing-assets' }
  { name: 'AZURE_PRIVATE_CONTAINER', value: 'private-exports' }
  { name: 'PUBLIC_ASSET_BASE_URL', value: 'https://${storage.name}.blob.${az.environment().suffixes.storage}/marketing-assets' }
  { name: 'COMPANY_NAME', value: 'Homix Realty' }
  { name: 'COMPANY_POSTAL_ADDRESS', value: companyPostalAddress }
  { name: 'COMPANY_WEBSITE', value: 'https://homixny.com' }
  { name: 'COMPANY_LISTINGS_URL', value: 'https://www.homixny.com/listings' }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
  { name: 'WORKER_POLL_INTERVAL_MS', value: '2000' }
  { name: 'JOB_LOCK_SECONDS', value: '120' }
  { name: 'WEBHOOK_RETENTION_DAYS', value: '90' }
  { name: 'AUDIT_RETENTION_DAYS', value: '365' }
  { name: 'ONEKEY_PROVIDER', value: oneKeyProvider }
  { name: 'BBO_LISTING_API_BASE_URL', value: bboListingApiBaseUrl }
  { name: 'ONEKEY_MEDIA_ALLOWED_ORIGINS', value: oneKeyMediaAllowedOrigins }
  { name: 'ONEKEY_SYNC_ENABLED', value: oneKeySyncEnabled ? 'true' : 'false' }
  { name: 'MLS_GRID_BASE_URL', value: 'https://api.mlsgrid.com/v2' }
  { name: 'MLS_GRID_ORIGINATING_SYSTEM_NAME', value: 'onekey2' }
  { name: 'AI_PROVIDER', value: aiProvider }
  { name: 'OPENAI_MODEL', value: openAiModel }
  { name: 'OPENAI_BASE_URL', value: openAiBaseUrl }
], useResendSecrets ? [{ name: 'RESEND_API_KEY', secretRef: 'resend-api-key' }, { name: 'RESEND_WEBHOOK_SECRET', secretRef: 'resend-webhook-secret' }] : [], usePreviousResendWebhookSecret ? [{ name: 'RESEND_WEBHOOK_PREVIOUS_SECRET', secretRef: 'resend-webhook-previous-secret' }, { name: 'RESEND_WEBHOOK_PREVIOUS_SECRET_EXPIRES_AT', value: resendWebhookPreviousSecretExpiresAt }] : [], usePreviousUnsubscribeSigningSecret ? [{ name: 'UNSUBSCRIBE_PREVIOUS_SIGNING_SECRET', secretRef: 'unsubscribe-previous-signing-secret' }, { name: 'UNSUBSCRIBE_PREVIOUS_SIGNING_SECRET_EXPIRES_AT', value: unsubscribePreviousSigningSecretExpiresAt }] : [], useBboMarketingApiKey ? [{ name: 'BBO_MARKETING_API_KEY', secretRef: 'bbo-marketing-api-key' }] : [], useMlsGridAccessToken ? [{ name: 'MLS_GRID_ACCESS_TOKEN', secretRef: 'mls-grid-access-token' }] : [], useOpenAiApiKey ? [{ name: 'OPENAI_API_KEY', secretRef: 'openai-api-key' }] : [])

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${namePrefix}'
  location: location
  tags: tags
  properties: { retentionInDays: environment == 'prod' ? 90 : 30 }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${namePrefix}'
  location: location
  kind: 'web'
  tags: tags
  properties: { Application_Type: 'web', WorkspaceResourceId: logs.id }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${namePrefix}'
  location: location
  tags: tags
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-01-01' = {
  name: 'vnet-${namePrefix}'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [vnetAddressPrefix] }
    subnets: [
      {
        name: 'snet-container-apps'
        properties: {
          addressPrefix: containerAppsSubnetPrefix
          delegations: [{ name: 'container-apps', properties: { serviceName: 'Microsoft.App/environments' } }]
        }
      }
      {
        name: 'snet-postgres'
        properties: {
          addressPrefix: postgresSubnetPrefix
          delegations: [{ name: 'postgres', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }]
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
      {
        name: 'snet-private-endpoints'
        properties: { addressPrefix: privateEndpointsSubnetPrefix, privateEndpointNetworkPolicies: 'Disabled' }
      }
    ]
  }
}

resource postgresDns 'Microsoft.Network/privateDnsZones@2024-06-01' = { name: 'private.postgres.database.azure.com', location: 'global', tags: tags }
resource postgresDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = { parent: postgresDns, name: 'link-${namePrefix}', location: 'global', properties: { virtualNetwork: { id: vnet.id }, registrationEnabled: false } }

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: 'psql-${namePrefix}-${uniqueSuffix}'
  location: location
  tags: tags
  sku: { name: postgresSkuName, tier: postgresTier }
  properties: union({
    administratorLogin: postgresAdminLogin
    version: '16'
    storage: { storageSizeGB: postgresStorageSizeGb }
    backup: { backupRetentionDays: postgresBackupRetentionDays, geoRedundantBackup: enableGeoRedundantBackup ? 'Enabled' : 'Disabled' }
    highAvailability: { mode: postgresHaMode }
    network: { delegatedSubnetResourceId: resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, 'snet-postgres'), privateDnsZoneArmResourceId: postgresDns.id, publicNetworkAccess: 'Disabled' }
  }, !empty(postgresAdminPassword) ? { administratorLoginPassword: postgresAdminPassword } : {})
  dependsOn: [postgresDnsLink]
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = { parent: postgres, name: databaseName, properties: { charset: 'UTF8', collation: 'en_US.utf8' } }

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'sthomixmkt${uniqueSuffix}'
  location: location
  tags: publicAssetTags
  sku: { name: storageSkuName }
  kind: 'StorageV2'
  // Email clients must be able to fetch the immutable marketing images without
  // authentication. The private container remains non-public and application
  // writes still use managed identity through the private endpoint.
  properties: { allowBlobPublicAccess: true, allowSharedKeyAccess: false, minimumTlsVersion: 'TLS1_2', supportsHttpsTrafficOnly: true, publicNetworkAccess: 'Enabled' }
}
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = { parent: storage, name: 'default', properties: { deleteRetentionPolicy: { enabled: true, days: environment == 'prod' ? 30 : 7 }, containerDeleteRetentionPolicy: { enabled: true, days: environment == 'prod' ? 30 : 7 } } }
resource marketingAssets 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = { parent: blobService, name: 'marketing-assets', properties: { publicAccess: 'Blob' } }
resource privateExports 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = { parent: blobService, name: 'private-exports', properties: { publicAccess: 'None' } }

resource blobDns 'Microsoft.Network/privateDnsZones@2024-06-01' = { name: 'privatelink.blob.${az.environment().suffixes.storage}', location: 'global', tags: tags }
resource blobDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = { parent: blobDns, name: 'link-${namePrefix}', location: 'global', properties: { virtualNetwork: { id: vnet.id }, registrationEnabled: false } }
resource storagePrivateEndpoint 'Microsoft.Network/privateEndpoints@2024-01-01' = { name: 'pe-${storage.name}-blob', location: location, tags: tags, properties: { subnet: { id: resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, 'snet-private-endpoints') }, privateLinkServiceConnections: [{ name: 'blob', properties: { privateLinkServiceId: storage.id, groupIds: ['blob'] } }] } }
resource storageDnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-01-01' = {
  parent: storagePrivateEndpoint
  name: 'default'
  properties: { privateDnsZoneConfigs: [{ name: 'blob', properties: { privateDnsZoneId: blobDns.id } }] }
  dependsOn: [blobDnsLink]
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-homix-${environment}-${uniqueSuffix}'
  location: location
  tags: tags
  properties: union({ tenantId: subscription().tenantId, enableRbacAuthorization: true, enableSoftDelete: true, softDeleteRetentionInDays: 90, publicNetworkAccess: 'Disabled', sku: { family: 'A', name: 'standard' } }, environment == 'prod' ? { enablePurgeProtection: true } : {})
}
resource vaultDns 'Microsoft.Network/privateDnsZones@2024-06-01' = { name: 'privatelink.vaultcore.azure.net', location: 'global', tags: tags }
resource vaultDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = { parent: vaultDns, name: 'link-${namePrefix}', location: 'global', properties: { virtualNetwork: { id: vnet.id }, registrationEnabled: false } }
resource vaultPrivateEndpoint 'Microsoft.Network/privateEndpoints@2024-01-01' = { name: 'pe-${vault.name}', location: location, tags: tags, properties: { subnet: { id: resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, 'snet-private-endpoints') }, privateLinkServiceConnections: [{ name: 'vault', properties: { privateLinkServiceId: vault.id, groupIds: ['vault'] } }] } }
resource vaultDnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-01-01' = {
  parent: vaultPrivateEndpoint
  name: 'default'
  properties: { privateDnsZoneConfigs: [{ name: 'vault', properties: { privateDnsZoneId: vaultDns.id } }] }
  dependsOn: [vaultDnsLink]
}

resource postgresPasswordSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(postgresAdminPassword)) { parent: vault, name: 'postgres-admin-password', properties: { value: postgresAdminPassword } }
resource databaseUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(postgresAdminPassword)) { parent: vault, name: 'postgres-runtime-url', properties: { value: postgresRuntimeUrl } }
resource directDatabaseUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(postgresAdminPassword)) { parent: vault, name: 'postgres-direct-url', properties: { value: postgresDirectUrl } }
resource sessionSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(postgresAdminPassword)) { parent: vault, name: 'session-secret', properties: { value: guid(postgresAdminPassword, resourceGroup().id, 'session') } }
resource unsubscribeSigningSecretResource 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(unsubscribeSigningSecret) || !empty(postgresAdminPassword)) { parent: vault, name: 'unsubscribe-signing-secret', properties: { value: !empty(unsubscribeSigningSecret) ? unsubscribeSigningSecret : guid(postgresAdminPassword, resourceGroup().id, 'unsubscribe') } }
resource unsubscribePreviousSigningSecretResource 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (usePreviousUnsubscribeSigningSecret && !empty(unsubscribePreviousSigningSecret)) { parent: vault, name: 'unsubscribe-previous-signing-secret', properties: { value: unsubscribePreviousSigningSecret } }
resource bboMarketingApiKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (useBboMarketingApiKey && !empty(bboMarketingApiKey)) { parent: vault, name: 'bbo-marketing-api-key', properties: { value: bboMarketingApiKey } }
resource mlsGridAccessTokenSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (useMlsGridAccessToken && !empty(mlsGridAccessToken)) { parent: vault, name: 'mls-grid-access-token', properties: { value: mlsGridAccessToken } }
resource openAiApiKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (useOpenAiApiKey && !empty(openAiApiKey)) { parent: vault, name: 'openai-api-key', properties: { value: openAiApiKey } }
resource resendApiKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(resendApiKey)) { parent: vault, name: 'resend-api-key', properties: { value: resendApiKey } }
resource resendWebhookSecretSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(resendWebhookSecret)) { parent: vault, name: 'resend-webhook-secret', properties: { value: resendWebhookSecret } }
resource entraClientSecretResource 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(entraClientSecret)) { parent: vault, name: 'entra-client-secret', properties: { value: entraClientSecret } }

resource vaultDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'send-audit-to-log-analytics'
  scope: vault
  properties: {
    workspaceId: logs.id
    logs: [{ categoryGroup: 'audit', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

resource keyVaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(vault.id, identity.id, 'kv-secrets-user'), scope: vault, properties: { principalId: identity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6') } }
resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(storage.id, identity.id, 'blob-contributor'), scope: storage, properties: { principalId: identity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe') } }
resource acrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(registry.id, identity.id, 'acr-pull'), scope: registry, properties: { principalId: identity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d') } }

resource containerEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${namePrefix}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: { destination: 'log-analytics', logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey } }
    vnetConfiguration: { infrastructureSubnetId: resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, 'snet-container-apps'), internal: false }
  }
}

resource customDomainManagedCertificate 'Microsoft.App/managedEnvironments/managedCertificates@2024-03-01' = if (!empty(customDomainName) && !empty(customDomainManagedCertificateName)) {
  parent: containerEnvironment
  name: customDomainManagedCertificateName
  location: location
  tags: tags
  properties: {
    subjectName: customDomainName
    domainControlValidation: 'CNAME'
  }
}

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-${namePrefix}-web'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    managedEnvironmentId: containerEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        customDomains: !empty(customDomainName) && !empty(customDomainManagedCertificateName) ? [{
          name: customDomainName
          bindingType: 'SniEnabled'
          certificateId: resourceId('Microsoft.App/managedEnvironments/managedCertificates', containerEnvironment.name, customDomainManagedCertificateName)
        }] : []
      }
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
      secrets: commonSecrets
    }
    template: {
      containers: [{
        name: 'web'
        image: webContainerImage
        env: concat(commonEnv, [{ name: 'APP_ROLE', value: 'web' }])
        resources: { cpu: json('0.5'), memory: '1Gi' }
        probes: [
          { type: 'Liveness', httpGet: { path: '/health/live', port: 3000, scheme: 'HTTP' }, initialDelaySeconds: 10, periodSeconds: 30 }
          { type: 'Readiness', httpGet: { path: '/health/ready', port: 3000, scheme: 'HTTP' }, initialDelaySeconds: 10, periodSeconds: 15 }
        ]
      }]
      scale: { minReplicas: webMinReplicas, maxReplicas: webMaxReplicas, rules: [{ name: 'http', http: { metadata: { concurrentRequests: '50' } } }] }
    }
  }
  dependsOn: [keyVaultRole, blobRole, acrPullRole, storageDnsGroup, vaultDnsGroup, database, databaseUrlSecret, directDatabaseUrlSecret, sessionSecret, unsubscribeSigningSecretResource, unsubscribePreviousSigningSecretResource, bboMarketingApiKeySecret, mlsGridAccessTokenSecret, openAiApiKeySecret, customDomainManagedCertificate]
}

resource worker 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-${namePrefix}-worker'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    managedEnvironmentId: containerEnvironment.id
    configuration: { activeRevisionsMode: 'Single', registries: [{ server: registry.properties.loginServer, identity: identity.id }], secrets: commonSecrets }
    template: { containers: [{ name: 'worker', image: workerContainerImage, env: concat(commonEnv, [{ name: 'APP_ROLE', value: 'worker' }]), resources: { cpu: json('0.5'), memory: '1Gi' } }], scale: { minReplicas: workerMinReplicas, maxReplicas: workerMaxReplicas } }
  }
  dependsOn: [web]
}

resource migrationJob 'Microsoft.App/jobs@2024-03-01' = {
  name: 'caj-${namePrefix}-migrate'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    environmentId: containerEnvironment.id
    configuration: { triggerType: 'Manual', replicaTimeout: 1800, replicaRetryLimit: 0, manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }, registries: [{ server: registry.properties.loginServer, identity: identity.id }], secrets: commonSecrets }
    template: { containers: [{ name: 'migrate', image: migrationContainerImage, env: concat(commonEnv, [{ name: 'APP_ROLE', value: 'migrate' }]), resources: { cpu: json('0.5'), memory: '1Gi' } }] }
  }
  dependsOn: [keyVaultRole, acrPullRole, database, databaseUrlSecret, directDatabaseUrlSecret, sessionSecret, unsubscribeSigningSecretResource, unsubscribePreviousSigningSecretResource, bboMarketingApiKeySecret, mlsGridAccessTokenSecret, openAiApiKeySecret]
}

resource webAuth 'Microsoft.App/containerApps/authConfigs@2024-03-01' = {
  parent: web
  name: 'current'
  properties: {
    platform: { enabled: true }
    globalValidation: { unauthenticatedClientAction: 'RedirectToLoginPage', redirectToProvider: 'azureactivedirectory', excludedPaths: publicPaths }
    identityProviders: { azureActiveDirectory: { enabled: true, registration: union({ clientId: entraClientId, openIdIssuer: '${az.environment().authentication.loginEndpoint}${entraTenantId}/v2.0' }, useEntraClientSecret ? { clientSecretSettingName: 'entra-client-secret' } : {}) } }
    login: { allowedExternalRedirectUrls: [baseUrl], preserveUrlFragmentsForLogins: false }
    httpSettings: { requireHttps: true, routes: { apiPrefix: '/.auth' }, forwardProxy: { convention: 'Standard' } }
  }
}

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = if (!empty(alertEmail)) { name: 'ag-${namePrefix}', location: 'global', tags: tags, properties: { groupShortName: 'HomixMkt', enabled: true, emailReceivers: [{ name: 'operations', emailAddress: alertEmail, useCommonAlertSchema: true }] } }
resource web5xxAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (!empty(alertEmail)) { name: 'alert-${namePrefix}-web-5xx', location: 'global', tags: tags, properties: { description: 'Homix Marketing web HTTP 5xx responses exceeded threshold.', severity: 2, enabled: true, scopes: [web.id], evaluationFrequency: 'PT5M', windowSize: 'PT15M', criteria: { 'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria', allOf: [{ name: 'Http5xx', metricName: 'Requests', metricNamespace: 'Microsoft.App/containerapps', operator: 'GreaterThan', threshold: 5, timeAggregation: 'Total', dimensions: [{ name: 'StatusCodeCategory', operator: 'Include', values: ['5xx'] }], criterionType: 'StaticThresholdCriterion' }] }, actions: [{ actionGroupId: actionGroup.id }] } }

@secure()
output applicationInsightsConnectionString string = appInsights.properties.ConnectionString
output acrLoginServer string = registry.properties.loginServer
output webFqdn string = web.properties.configuration.ingress.fqdn
output webAppName string = web.name
output workerAppName string = worker.name
output migrationJobName string = migrationJob.name
output containerAppsEnvironmentName string = containerEnvironment.name
output keyVaultName string = vault.name
output storageAccountUrl string = 'https://${storage.name}.blob.${az.environment().suffixes.storage}'
output postgresServerFqdn string = postgres.properties.fullyQualifiedDomainName
output managedIdentityClientId string = identity.properties.clientId
output managedIdentityResourceId string = identity.id
