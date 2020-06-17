# Introduction

This article demonstrates how to Load Test an application deployed in a Kubernetes cluster, verify that the autoscaling is working, and identify potential performance bottlenecks. 

The best approach is to automate scaling. This can be triggered by monitoring custom metrics such cpu usage, network bandwidth or http requests per second. Scaling an application running on a Kubernetes platform can be done in the following ways:

- Horizontal : Adjust the number of replicas(pods)
- Vertical : Adjust resource requests and limits imposed on a container

![LoadTesting](./imagenes/LoadTesting.png)

# Kube State Metrics

Información about Kube State Metrics can be seen [here](https://github.com/kubernetes/kube-state-metrics) and [here](https://devopscube.com/setup-kube-state-metrics/).

Kube State metrics is s service which talks to Kubernetes API server to get all the details about all the API objects like deployments, pods, daemonsets etc. Basically it provides kubernetes API object metrics which you cannot get directly from native Kubernetes monitoring components. Kube state metrics service exposes all the metrics on /metrics URI. Prometheus can scrape all the metrics exposed by kube state metrics.

- Monitor __node status__, __node capacity__ (CPU and memory)
- Monitor replica-set compliance (desired/available/unavailable/updated status of replicas per deployment)
- Monitor __pod status__ (waiting, running, ready, etc)
- Monitor the __resource requests and limits__.
- Monitor Job & Cronjob Status

To install it we clone the repo `https://github.com/devopscube/kube-state-metrics-configs.git`.

```ps
kubectl apply -f .\kube-state-metrics-configs\
```

Check the deployment status using the following command:

```ps
kubectl get deployments kube-state-metrics -n kube-system
```

We can configure Prometheus to scrap the metrics as:

```yaml
- job_name: 'kube-state-metrics'
  static_configs:
    - targets: ['kube-state-metrics.kube-system.svc.cluster.local:8080']
```

# Prometheus

Información about how to setup Prometheus can be seen [here](https://devopscube.com/setup-prometheus-monitoring-on-kubernetes/).

## Monitoring namespace

First, we will create a Kubernetes namespace for all our monitoring components.

```ps
kubectl create namespace seguimiento
```

## RBAC configuration

You need to assign cluster reader permission to this namespace so that Prometheus can fetch the metrics from Kubernetes API’s.

```ps
kubectl create -f .\kubernetes-prometheus\clusterRole.yaml
```

## Prometheus configuration

We should create a config map with all the prometheus scrape config and alerting rules, which will be mounted to the Prometheus container in `/etc/prometheus` as prometheus.yaml and prometheus.rules files.

```ps
kubectl create -f .\kubernetes-prometheus\config-map.yaml
```

The config map includes the prometheus.yml, the file that contains all the configuration to dynamically discover pods and services running in the Kubernetes cluster. We have the following scrape jobs in our Prometheus scrape configuration.

```yaml
  prometheus.yml: |-
    global:
      scrape_interval: 5s
      evaluation_interval: 5s
    rule_files:
      - /etc/prometheus/prometheus.rules
    alerting:
      alertmanagers:
      - scheme: http
        static_configs:
        - targets:
          - "alertmanager.seguimiento.svc:9093"

    scrape_configs:
      - job_name: 'kubernetes-apiservers'

        kubernetes_sd_configs:
        - role: endpoints
        scheme: https

        tls_config:
          ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
        bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token

        relabel_configs:
        - source_labels: [__meta_kubernetes_namespace, __meta_kubernetes_service_name, __meta_kubernetes_endpoint_port_name]
          action: keep
          regex: default;kubernetes;https

      - job_name: 'kubernetes-nodes'

        scheme: https

        tls_config:
          ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
        bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token

        kubernetes_sd_configs:
        - role: node

        relabel_configs:
        - action: labelmap
          regex: __meta_kubernetes_node_label_(.+)
        - target_label: __address__
          replacement: kubernetes.default.svc:443
        - source_labels: [__meta_kubernetes_node_name]
          regex: (.+)
          target_label: __metrics_path__
          replacement: /api/v1/nodes/${1}/proxy/metrics

      
      - job_name: 'kubernetes-pods'

        kubernetes_sd_configs:
        - role: pod

        relabel_configs:
        - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
          action: keep
          regex: true
        - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
          action: replace
          target_label: __metrics_path__
          regex: (.+)
        - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
          action: replace
          regex: ([^:]+)(?::\d+)?;(\d+)
          replacement: $1:$2
          target_label: __address__
        - action: labelmap
          regex: __meta_kubernetes_pod_label_(.+)
        - source_labels: [__meta_kubernetes_namespace]
          action: replace
          target_label: kubernetes_namespace
        - source_labels: [__meta_kubernetes_pod_name]
          action: replace
          target_label: kubernetes_pod_name
      
      - job_name: 'kube-state-metrics'
        static_configs:
          - targets: ['kube-state-metrics.kube-system.svc.cluster.local:8080']

      - job_name: 'kubernetes-cadvisor'

        scheme: https

        tls_config:
          ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
        bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token

        kubernetes_sd_configs:
        - role: node

        relabel_configs:
        - action: labelmap
          regex: __meta_kubernetes_node_label_(.+)
        - target_label: __address__
          replacement: kubernetes.default.svc:443
        - source_labels: [__meta_kubernetes_node_name]
          regex: (.+)
          target_label: __metrics_path__
          replacement: /api/v1/nodes/${1}/proxy/metrics/cadvisor
      
      - job_name: 'kubernetes-service-endpoints'

        kubernetes_sd_configs:
        - role: endpoints

        relabel_configs:
        - source_labels: [__meta_kubernetes_service_annotation_prometheus_io_scrape]
          action: keep
          regex: true
        - source_labels: [__meta_kubernetes_service_annotation_prometheus_io_scheme]
          action: replace
          target_label: __scheme__
          regex: (https?)
        - source_labels: [__meta_kubernetes_service_annotation_prometheus_io_path]
          action: replace
          target_label: __metrics_path__
          regex: (.+)
        - source_labels: [__address__, __meta_kubernetes_service_annotation_prometheus_io_port]
          action: replace
          target_label: __address__
          regex: ([^:]+)(?::\d+)?;(\d+)
          replacement: $1:$2
        - action: labelmap
          regex: __meta_kubernetes_service_label_(.+)
        - source_labels: [__meta_kubernetes_namespace]
          action: replace
          target_label: kubernetes_namespace
        - source_labels: [__meta_kubernetes_service_name]
          action: replace
          target_label: kubernetes_name
```

- kubernetes-apiservers: It gets all the metrics from the API servers.

```yaml
    scrape_configs:
      - job_name: 'kubernetes-apiservers'
```

- kubernetes-nodes: All Kubernetes node metrics will be collected with this job.

```yaml
    scrape_configs:
      - job_name: 'kubernetes-nodes'
```

- kubernetes-pods: All the pod metrics will be discovered if the pod metadata is annotated with prometheus.io/scrape and prometheus.io/port annotations.

```yaml
    scrape_configs:
      - job_name: 'kubernetes-pods'
```

- kube-state metrics: Collects all kube state metrics - we installed kube state earlier.

```yaml
    scrape_configs:
      - job_name: 'kube-state-metrics'
```

- kubernetes-cadvisor: Collects all cAdvisor metrics.

```yaml
    scrape_configs:
      - job_name: 'kubernetes-cadvisor'
```

- kubernetes-service-endpoints: All the Service endpoints will be scrapped if the service metadata is annotated with prometheus.io/scrape and prometheus.io/port annotations. It will be a blackbox monitoring.

```yaml
    scrape_configs:
      - job_name: 'kubernetes-service-endpoints'
```

## Deploy Prometheus

We are mounting the Prometheus config map as a file inside /etc/prometheus. It uses the official Prometheus image from docker hub:

```ps
kubectl create -f .\kubernetes-prometheus\prometheus-deployment.yaml
```

We can check the deployment with:

```ps
kubectl get deployments --namespace=seguimiento

NAME                    READY   UP-TO-DATE   AVAILABLE   AGE
prometheus-deployment   1/1     1            1           41s
```

## Connecting To Prometheus Dashboard

We can view the deployed Prometheus dashboard in two ways:

- Using Kubectl port forwarding
- Exposing the Prometheus deployment as a service with NodePort or a Load Balancer.

### Port Forwarding

First, get the Prometheus pod name:

```ps
kubectl get pods --namespace=seguimiento

NAME                                     READY   STATUS    RESTARTS   AGE
prometheus-deployment-7bb6c5d7fd-fst5b   1/1     Running   0          6m24s
```

```ps
kubectl port-forward prometheus-deployment-7bb6c5d7fd-fst5b 8084:9090 -n seguimiento

Forwarding from 127.0.0.1:8084 -> 9090
Forwarding from [::1]:8084 -> 9090
```

Now we can open the url `http://localhost:8084/graph`:

![Prometheus](./imagenes/Prometheus.png)

### Exposing Prometheus as a Service

To access the Prometheus dashboard over a IP or a DNS name, you need to expose it as Kubernetes service. 

```ps
kubectl create -f .\kubernetes-prometheus\prometheus-service.yaml
```

```ps
kubectl get svc -n seguimiento

NAME                 TYPE           CLUSTER-IP   EXTERNAL-IP   PORT(S)          AGE
prometheus-service   LoadBalancer   10.0.97.48   51.103.2.45   8084:31526/TCP   52s
```

if we now open the browser at `http:51.103.2.45:8084`:

![Prometheus](./imagenes/Prometheus1.png)

# The Application

The application is a nodejs api. We can found it in `server.js`. Lets review it. We are creating a server using the json-server api. It allows us to expose a rest api with the full blown set of http methods based on a json file, a sort of data store. In our case the file is db.json. It contains:

```json
{
  "crocodiles": [
    {
      "id": 1,
      "name": "Bert",
      "sex": "M",
      "date_of_birth": "2010-06-27",
      "age": 9
    },
    {
      "id": 2,
      "name": "Ed",
      "sex": "M",
      "date_of_birth": "1995-02-27",
      "age": 25
    }
	
	(...)
```

This will expose the resource `crocodiles` with the different methods get, post, put, ... For example `GET /crocodiles` will list the contents of the file, `GET /crocodiles/1` will list the first item, `POST /crocodiles` will insert a new object, etc. The json-server could be run in stand alone, and has [many other options](https://www.npmjs.com/package/json-server). In our case we will use it to create a nodejs app. We create a server using:

```js
const jsonServer = require('json-server');
const app = jsonServer.create();
```

We are going to instrument the app in prometheus. We could leverage many libraries to integrate our app with prometheus, we will rely on the `@tailorbrands/node-exporter-prometheus` library:

```js
const prometheusExporter = require('@tailorbrands/node-exporter-prometheus');
const options = {
  appName: "crocodile-api",
  collectDefaultMetrics: true,
  ignoredRoutes: ['/metrics', '/favicon.ico', '/__rules']
};
const promExporter = prometheusExporter(options);
```

There are many more [libraties created by the community](https://www.npmjs.com/search?q=prometheus). 

Once we have configured the library - above -, we set up a middleware so all the requests received in the nodejs app are instrumented. We expose the metrics using the `GET metrics` resource:

```js
app.use(promExporter.middleware);
app.get('/metrics', promExporter.metrics);
```

We expose the json server as a middleware. This will add to our nodejs app all the resources available in db.json, and with all the http verbs:

```js
const middlewares = jsonServer.defaults()
app.use(middlewares);
```

We also create a custom middleware to introduce a delay in the requests made to the crocodiles resource:

```js
app.use('/crocodiles', function (req, res, next) {
  let delay = Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay;
  setTimeout(next, delay)
});

const router = jsonServer.router('db.json');
app.use(router);
```

So in summary, we use the json server to expose the resources with the data defined in db.json, we also expose the prometheus metrics in an endpoint, and we are introducing a middleware that sets a delay in the requests to the crocodrile resource.

## Build the image

Lets test the Node App first:

```ps
npm i

npm run dev
```

We can try the app in `http://localhost:4000/crocodiles`. 

We create next the image. With docker started we prune old unused images:

```ps
docker image prune -f
```

We build the image. Notice that we are tagging it with our Azure registry because once the image is built we are going to push it there

```ps
docker build -t pruebacontenedor.azurecr.io/crocodile-api:latest .
```

We can try the image in docker:

```ps
docker run -it -p 4000:4000 pruebacontenedor.azurecr.io/crocodile-api:latest
```

We will finally push the image to the Azure registry. We have to log into the registry first, and then push it:

```ps
docker login  -u pruebacontenedor -p Pr0bDGtfdIKbWj+pGbGEsFpc8D/3enAH https://pruebacontenedor.azurecr.io

docker push pruebacontenedor.azurecr.io/crocodile-api:latest
```

## Deploy the app

We can now deploy the app to Kubernetes. First we´ll create the credentials to pull the image from the Azure registry:

```ps
kubectl create secret docker-registry miaks --namespace default --docker-server=pruebacontenedor.azurecr.io --docker-username=pruebacontenedor --docker-password=Pr0bDGtfdIKbWj+pGbGEsFpc8D/3enAH
```	

We are ready to deploy the resources:
	
```ps
kubectl apply -f deploy/crocodile-deployment.yml
```

We can try it in:

```ps
kubectl get svc

NAME                TYPE           CLUSTER-IP     EXTERNAL-IP    PORT(S)          AGE
crocodile-service   LoadBalancer   10.0.98.249    51.103.1.161   4000:30403/TCP   17m
```

```ps
curl -v http://51.103.1.161:4000/crocodiles


VERBOSE: GET http://51.103.1.161:4000/crocodiles with 0-byte payload
VERBOSE: received 897-byte response of content type application/json; charset=utf-8


StatusCode        : 200
StatusDescription : OK
Content           : [
                      {
                        "id": 1,
                        "name": "Bert",
                        "sex": "M",
                        "date_of_birth": "2010-06-27",
                        "age": 9
                      },
                      {
                        "id": 2,
                        "name": "Ed",
                        "sex": "M",
                        "date_of_birth": "1995-02-27",
                        "a...
RawContent        : HTTP/1.1 200 OK
                    vary: Origin, Accept-Encoding
                    access-control-allow-credentials: true
                    pragma: no-cache
                    x-content-type-options: nosniff
                    x-envoy-upstream-service-time: 167
                    x-envoy-decorator-operati...
Forms             : {}
Headers           : {[vary, Origin, Accept-Encoding], [access-control-allow-credentials,
                    true], [pragma, no-cache], [x-content-type-options, nosniff]...}
Images            : {}
InputFields       : {}
Links             : {}
ParsedHtml        : mshtml.HTMLDocumentClass
RawContentLength  : 897
```

We have also instrumented the api, so it is exposing metrics in the standard endpoint that will be used later on by prometheus:

```ps
curl -v http://51.103.1.161:4000/metrics


VERBOSE: GET http://51.103.1.161:4000/metrics with 0-byte payload
VERBOSE: received 6510-byte response of content type text/plain; version=0.0.4;
charset=utf-8


StatusCode        : 200
StatusDescription : OK
Content           : # HELP node_http_duration_seconds Duration of HTTP requests in seconds
                    # TYPE node_http_duration_seconds summary
                    node_http_duration_seconds{quantile="0.5",appName="crocodile-api"}
                    0.167208918
                    node_htt...
RawContent        : HTTP/1.1 200 OK
                    x-envoy-upstream-service-time: 1
                    x-envoy-decorator-operation:
                    crocodile-service.default.svc.cluster.local:4000/*
                    Content-Length: 6510
                    Content-Type: text/plain; version=0.0.4; chars...
Forms             : {}
Headers           : {[x-envoy-upstream-service-time, 1], [x-envoy-decorator-operation,
                    crocodile-service.default.svc.cluster.local:4000/*], [Content-Length,
                    6510], [Content-Type, text/plain; version=0.0.4; charset=utf-8]...}
Images            : {}
InputFields       : {}
Links             : {}
ParsedHtml        : mshtml.HTMLDocumentClass
RawContentLength  : 6510
```

# Stress Test it with K6



# Annex

## Configure Minikube

To use minikube instead of Azure KS. Once minikube is up and running, enable the following addons:

```bash
$ minikube addons enable dashboard
$ minikube addons enable ingress # optional
$ minikube addons enable ingress-dns # optional
```

To access dashboard, type the following command from a terminal: `minikube dashboard`. You'll need to open a separate terminal and execute the following:

```bash
minikube tunnel
```

This will allow you to easily access `ClusterPort` services via your web browser.