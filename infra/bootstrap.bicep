targetScope = 'subscription'

@description('Azure region for all Homix Marketing resources.')
param location string = 'eastus2'

@allowed(['dev', 'prod'])
param environment string

param resourceGroupName string
param acrName string = 'acrhomixmkt${take(uniqueString(subscription().id, resourceGroupName), 10)}'

var tags = {
  application: 'homix-marketing'
  environment: environment
  owner: 'homix-group'
  managedBy: 'bicep'
  dataClassification: 'internal'
}

resource resourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module bootstrapResources './modules/bootstrap-resources.bicep' = {
  name: 'homix-marketing-bootstrap-${environment}'
  scope: resourceGroup
  params: {
    location: location
    acrName: acrName
    tags: tags
  }
}

output resourceGroupName string = resourceGroup.name
output acrName string = bootstrapResources.outputs.acrName
output acrLoginServer string = bootstrapResources.outputs.acrLoginServer
