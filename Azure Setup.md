# Login

Hacemos login:

```ps
az login
```

Tengo dos accounts en Azure:

```ps
az account list

A few accounts are skipped as they don't have 'Enabled' state. Use '--all' to display them.
[
  {
    "cloudName": "AzureCloud",
    "id": "3b4b5fb2-4929-4d43-98ec-f42fbb81f379",
    "isDefault": false,
    "name": "Visual Studio Professional",
    "state": "Enabled",
    "tenantId": "c2e7c8ec-a7ce-496c-82ae-6dd056f6c099",
    "user": {
      "name": "egsmartin@hotmail.com",
      "type": "user"
    }
  },
  {
    "cloudName": "AzureCloud",
    "id": "faa17e57-ec95-4169-ba7a-ee7c2f41a0aa",
    "isDefault": true,
    "name": "Windows Azure MSDN - Visual Studio Professional",
    "state": "Enabled",
    "tenantId": "c2e7c8ec-a7ce-496c-82ae-6dd056f6c099",
    "user": {
      "name": "egsmartin@hotmail.com",
      "type": "user"
    }
  }
]
```

Seleccionamos una de ellas por defecto:

```ps
az account set --subscription faa17e57-ec95-4169-ba7a-ee7c2f41a0aa
```

# Configurar kubectl

Para configurar nuestro cluster en el archivo config del kubectl haremos lo siguiente:

```ps
az aks get-credentials --resource-group miKubernetes --name miCluster
```

# Dashboard

Para abrir el browser:

```ps
az aks browse --resource-group miKubernetes --name miCluster
```

También podemos hacer:

```ps
Start-Job -ScriptBlock {az aks browse --resource-group miKubernetes --name miCluster}
```

## Credenciales

Con la última version de Kubernetes, en Azure el usuario que se usa para abrir la consola no tiene permisos. Tendremos que dar accesos. El usuario que se utiliza por defecto es `kubernetes-dashboard` - bueno, en realidad no debería decir usuario sino `system account`:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: kubernetes-dashboard-admin
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
- kind: ServiceAccount
  name: kubernetes-dashboard
  namespace: kube-system
```

Con esto estamos asignando el role `cluster-admin` al usuario que se utiliza para acceder a al dashboard.

### Crear un system account diferente

Podemos crear una nueva `system account`, asignarle el rol administrador. Creamos la sistem account:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: aks-dashboard-admin
  namespace: kube-system
```

Una vez creada esta system account - `aks-dashboard-admin` es la account creada. Ahora le asignamos el rol:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: aks-dashboard-admin
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
- kind: ServiceAccount
  name: aks-dashboard-admin
  namespace: kube-system
```

Una vez creado la account, y asignado el rol, tendremos que hacer login. En el login `http://127.0.0.1:8001/#!/login` especificaremos las credenciales. El token asociado a esta account lo podemos obtener así:

```ps
$data = kubectl get secret --namespace=kube-system $(kubectl get serviceaccount --namespace=kube-system aks-dashboard-admin -o jsonpath="{.secrets[0].name}") -o jsonpath="{.data.token}"
```

El token esta codificado en base 64. Lo decodificamos: 

```ps
[System.Text.Encoding]::ASCII.GetString([System.Convert]::FromBase64String($data))
```