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

The configuration in Prometheus is explained [here](https://prometheus.io/docs/prometheus/latest/configuration/configuration/). We have specialied tags that configure given products - that are popular, in order to ease the configuration. In the case of Kubernetes we have such a configuration with the tag `kubernetes_sd_config`. With [kubernetes_sd_config](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#kubernetes_sd_config) we specify:

- Discover target: node, service, pod, endpoint or ingress

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

### Check Prometheus

We can check the metrics that Prometheus has scrapped by going to the Prometheus dashboard, and selecting `status->targets`.

## Notas

We did not use the resource `prometheus-ingress.yaml` for this lab.

# Grafana

To set up Grafana, we create first the configmap with the configuration to be used by Grafana:

```ps
kubectl create -f .\kubernetes-grafana\grafana-datasource-config.yaml
```

In this configmap we are setting the data sources for Grafana. In our case we are setting Prometheus at `http://prometheus-service.seguimiento.svc:8084`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-datasources
  namespace: seguimiento
data:
  prometheus.yaml: |-
    {
        "apiVersion": 1,
        "datasources": [
            {
               "access":"proxy",
                "editable": true,
                "name": "prometheus",
                "orgId": 1,
                "type": "prometheus",
                "url": "http://prometheus-service.seguimiento.svc:8084",
                "version": 1
            }
        ]
    }
```

We create the deployment:

```ps
kubectl create -f .\kubernetes-grafana\deployment.yaml
```

__Note:__ In `deploymentLargerSpecs.yaml` we have a similar deployment only with larger request settings.

We create a Loadbalanced service to expose the grafana dashboard:

```ps
kubectl create -f .\kubernetes-grafana\serviceLB.yaml
```

We can check it out:

```ps
kubectl get svc -n seguimiento

NAME                 TYPE           CLUSTER-IP     EXTERNAL-IP    PORT(S)          AGE
grafana              LoadBalancer   10.0.89.160    51.103.2.197   3000:31674/TCP   28s
prometheus-service   LoadBalancer   10.0.122.197   51.103.2.45    8084:30428/TCP   15h
```

and at `http://51.103.2.197:3000/login`:

![Grafana](./imagenes/grafana.png)

Use the following default username and password to log in. Once you log in with default credentials, it will prompt you to change the default password.

```ps
User: admin
Pass: admin
```

## Setup Kubernetes Dashbaords

There are many prebuilt Grafana templates available for various data sources. You can [check out the templates from here](https://grafana.com/grafana/dashboards?search=kubernetes&orderBy=name&direction=asc).

- Step 1: Get the template ID from [grafana public template](https://grafana.com/grafana/dashboards/8588). as shown below.

![Step1](./imagenes/Step1.png)

- Step 2: Head over to grafana and select the import option.

![Step2](./imagenes/Step2.png)

Step 3: Enter the dashboard ID you got it step 1

![Step3](./imagenes/Step3.png)

Step 4: Grafana will automatically fetch the template from Grafana website. You can change the values as shown in the image below and click import.

![Step4](./imagenes/Step4.png)

The dashboard is shown:

![Step5](./imagenes/Step5.png)

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

We can read more about k6 [here](https://k6.io/docs/getting-started/running-k6).

We have a couple of stress tests in two k6 load test configurations:

- The first option is a quick 3 minute load test you can use to quickly confirm metrics are being captured

```js
export let options = {
  duration: "3m",
  vus: 200,
  thresholds: {
    http_req_duration: ["p(95)<700"]
  }
};
```

- The second option allows us to scale the number of virtual users over a duration of 12 minutes. This will give us enough data to analyze performance and behavior of our autoscaling configuration.

```js
export let options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '1m', target: 150 },
    { duration: '1m', target: 300 },
    { duration: '2m', target: 500 },
    { duration: '2m', target: 800 },
    { duration: '3m', target: 1200 },
    { duration: '3m', target: 50 },
  ],
};
```

k6 works with the concept of virtual users (VUs), which run scripts - they're essentially glorified, parallel while(true) loops. Scripts are written using JavaScript, as ES6 modules, which allows you to break larger tests into smaller pieces, or make reusable pieces as you like - although the underlining implementation of k6 is in __go__.

Scripts must contain, at the very least, a default function - this defines the entry point for your VUs, similar to the main() function in many other languages:

```js
export default function () {
  let r = http.get(`${__ENV.ENDPOINT}`);
  check(r, {
    'status is 200': r => r.status === 200,
  });
  sleep(3);
}
```

Code inside default is called "VU code", and is run over and over for as long as the test is running. Code outside of it is called "init code", and is run only once per VU.

```js
// init code

export default function( {
  // vu code
}
```

VU code can make HTTP requests, emit metrics, and generally do everything you'd expect a load test to do - with a few important exceptions: you can't load anything from your local filesystem, or import any other modules. 

## Life Cycle 

Read more about the different [life cycle stages of a k6 test](https://k6.io/docs/using-k6/test-life-cycle).

There are four distinct life cycle stages to a k6 test that can be controlled by you, the user. They are the "init", "setup", "vu" and "teardown" stages. 

```js
// 1. init code

export function setup() {
  // 2. setup code
}

export default function(data) {
  // 3. vu code
}

export function teardown(data) {
  // 4. teardown code
}
```

Code inside default is called "VU code", and is run over and over for as long as the test is running. Code outside of it is called "init code", and is run only once per VU.

VU code can make HTTP requests, emit metrics, and generally do everything you'd expect a load test to do - with a few important exceptions: __you can't load anything from your local filesystem, or import any other modules__. This all __has to be done from the init code__.

There are two reasons for this. The first is, of course: performance.

If you read a file from disk on every single script iteration, it'd be needlessly slow; even if you cache the contents of the file and any imported modules, it'd mean the first run of the script would be much slower than all the others. Worse yet, if you have a script that imports or loads things based on things that can only be known at runtime, you'd get slow iterations thrown in every time you load something new.

But there's another, more interesting reason. By forcing all imports and file reads into the init context, we make an important design goal possible; we want to support three different execution modes without the need for you to modify your scripts; local, cloud and clustered execution. In the case of cloud and clustered execution we know which files will be needed, so we distribute only those files. We know which modules will be imported, so we can bundle them up from the get-go. And, tying into the performance point above, the other nodes don't even need writable filesystems - everything can be kept in-memory.

As an added bonus, __you can use this to reuse data between iterations (but only for the same VU)__:

```js
var counter = 0;

export default function() {
  counter++;
}
```

### The default function life-cycle

A VU will execute the default function from start to end in sequence. Nothing out of the ordinary so far, but here's the important part; once the VU reaches the end of the default function it will loop back to the start and execute the code all over.

__As part of this "restart" process, the VU is reset__. __Cookies are cleared and TCP connections might be torn down__, depending on your test configuration options. __Make sure to use sleep() statements to pace your VUs properly__. __An appropriate amount of sleep/think time at the end of the default function is often needed to properly simulate a user reading content on a page__. If you don't have a sleep() statement at the end of the default function your VU might be more "aggressive" than you've planned. __VU without any sleep() is akin to a user who constantly presses F5 to refresh the page__.

### Setup and teardown stages

Beyond the required init and VU stages, which is code run for each VU, k6 also supports __test-wide setup and teardown stages__, like many other testing frameworks and tools. The setup and teardown functions, like the default function, __needs to be exported functions__. But unlike the default function setup and teardown __are only called once for a test__. __setup is called at the beginning of the test__, __after the init stage__ but __before the VU stage__ (default function), and __teardown__ is called at the __end of a test__, __after the VU stage__ (default function). Therefore, VU number is 0 while executing the setup and teardown functions.

Again, let's have a look at the basic structure of a k6 test:

```js
// 1. init code

export function setup() {
  // 2. setup code
}

export default function(data) {
  // 3. vu code
}

export function teardown(data) {
  // 4. teardown code
}
```

Notice the function signature of the default function and teardown function takes an argument, which we here refer to as data.

This __data will be whatever is returned in the setup function__, so a mechanism for passing data from the setup stage to the subsequent VU and teardown stages in a way that, again, is compatible with our goal of supporting local, cloud and clustered execution modes without requiring script changes when switching between them. (it might or might not be the same node that runs the setup and teardown stages in the cloud or clustered execution mode).

To support all of those modes, only data (i.e. JSON) can be passed between setup() and the other stages, any passed functions will be stripped.

Here's an example of doing just that, passing some data from setup to VU and teardown stages:

```js
export function setup() {
  return { v: 1 };
}

export default function(data) {
  console.log(JSON.stringify(data));
}

export function teardown(data) {
  if (data.v != 1) {
    throw new Error("incorrect data: " + JSON.stringify(data));
  }
}
```

A big difference between the init stage and setup/teardown stages is that you have the full k6 API available in the latter, you can for example make HTTP requests in the setup and teardown stages:

```js
export function setup() {
  let res = http.get("https://httpbin.org/get");
  return { data: res.json() };
}

export function teardown(data) {
  console.log(JSON.stringify(data));
}

export default function(data) {
  console.log(JSON.stringify(data));
}
```

Note that any requests made in the setup and teardown stages will be counted in the end-of-test summary. Those requests will be tagged appropriately with the ::setup and ::teardown values for the group metric tag, so that you can filter them in JSON output or InfluxDB.

## Using options

If you want to avoid having to type --vus 10 and --duration 30s all the time, you can include those settings inside your JavaScript file also:

```js
import http from 'k6/http';
import { sleep } from 'k6';
export let options = {
  vus: 10,
  duration: '30s',
};
export default function() {
  http.get('http://test.k6.io');
  sleep(1);
}
```

## Stages: ramping up/down VUs

You can also have the VU level ramp up and down during the test. The options.stages property allows you to configure ramping behaviour.

```js
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m30s', target: 10 },
    { duration: '20s', target: 0 },
  ],
};

export default function() {
  let res = http.get('https://httpbin.org/');
  check(res, { 'status was 200': r => r.status == 200 });
  sleep(1);
}
```

## Our test scripts

```js
import { check, sleep } from 'k6';
import http from "k6/http";

export let options = {
  duration: "3m",
  vus: 200,
  thresholds: {
    http_req_duration: ["p(95)<700"]
  }
};

export default function () {
  let r = http.get(`${__ENV.ENDPOINT}`);
  check(r, {
    'status is 200': r => r.status === 200,
  });
  sleep(3);
}
```

# KEDA

[KEDA](https://keda.sh/) is a Kubernetes Event-driven Autoscaling service. It works alongside Horizontal Pod Autoscaler to scale pods up and down based on a threshold that we'll need to specify. Instructions for deploying using YAML files can be found on [this](https://keda.sh/docs/1.4/deploy/#yaml) page. 

```ps
git clone https://github.com/kedacore/keda && cd keda

kubectl apply -f deploy/crds/keda.k8s.io_scaledobjects_crd.yaml
kubectl apply -f deploy/crds/keda.k8s.io_triggerauthentications_crd.yaml
kubectl apply -f deploy/
```

We can check that all is running:

```ps
kubectl get po -n keda

NAME                                      READY   STATUS    RESTARTS   AGE
keda-metrics-apiserver-55b685cd77-jfd45   1/1     Running   0          2m7s
keda-operator-6fb4678777-nvd26            1/1     Running   0          2m8s
```

Lets remember where Prometheus was exposed:

```ps
kubectl get svc -n seguimiento

NAME                 TYPE           CLUSTER-IP     EXTERNAL-IP    PORT(S)          AGE
grafana              LoadBalancer   10.0.89.160    51.103.2.197   3000:31674/TCP   32h
prometheus-service   LoadBalancer   10.0.122.197   51.103.2.45    8084:30428/TCP   47h
```

We can open `http:51.103.2.45:8084` and then look for a label `kubernetes_name` with the value `crocodile-service` under the section `kubernetes-service-endpoints`. 

![Crocodile in Prometheus](./imagenes/CrocodilePrometheus.png)

This entry is showing up because in the prometheus configmap we have this entry:

```yaml
- job_name: 'kubernetes-service-endpoints'

	kubernetes_sd_configs:
	- role: endpoints 
```

Here Prometheus uses the kubernetes API to retrieve all the endpoints that do expose a `/metrics` endpoint.

We should also confirm that the service kube-state-metrics has been discovered as well. On the top menu, click the Graph link to go to the graph page. This is where we enter query expressions to access the vast information that Prometheus is currently scraping.

Before we execute a query, fire up the k6 load testing tool to get some data to work with. Lets see where our crocodile service is exposed:

```ps
kubectl get svc

NAME                TYPE           CLUSTER-IP     EXTERNAL-IP    PORT(S)          AGE
crocodile-service   LoadBalancer   10.0.98.249    51.103.1.161   4000:30403/TCP   2d8h
details             ClusterIP      10.0.115.104   <none>         9080/TCP         4d15h
kubernetes          ClusterIP      10.0.0.1       <none>         443/TCP          4d17h
productpage         ClusterIP      10.0.60.171    <none>         9080/TCP         4d15h
ratings             ClusterIP      10.0.148.64    <none>         9080/TCP         4d15h
reviews             ClusterIP      10.0.114.83    <none>         9080/TCP         4d15h
```

We can now run the test - checkout [this](https://k6.io/docs/using-k6/environment-variables):

```ps
k6 run -e ENDPOINT=http://51.103.1.161:4000/crocodiles ./stress-test/performance-test1.js
```

On the Prometheus dashboard, in the Graph page, enter this expression: node_http_requests_total. It should autofill for you as you type. Click on the Graph tab and you should see the following output:

![First Test1](./imagenes/CrocodileTest1.png)

The node_http_requests_total metric keeps track of the total number of requests per HTTP status code. If you were to run the test, the line graph will start shooting up from where it left of. This metric doesn't seem useful in it's current form.

![First Test2](./imagenes/CrocodileTest2.png)

Fortunately, we can apply a function to make it useful. We can use the rate() function to calculate the number of requests per second over a specified duration. Update the expression as follows:

```js
rate(node_http_requests_total[2m])
```

This function will give us the number of requests per second within a 2 minute window. Basically, it calculates how fast are the increments increasing per second. When the increments stop, the rate() function will give us 0. Below are the results of the load test with the rate function applied in the expression:

![First Test3](./imagenes/CrocodileTest3.png)

## Influx DB, Prometheus and Grafana

We install [Influx DB](https://www.influxdata.com/get-influxdb/), and [Grafana](https://grafana.com/get). We then run Influxdb:

```ps
influxd.exe
```

We configure the influx db datasource in Grafana as:

```yaml
Name: InfluxDB-K6
URL: http://localhost:8086
Access: Server
Database: k6
HTTP Method: GET
Min time interval: 5s
```

The K6 database will be created in InfluxDb the minute we start the test run with the [output setting] (https://k6.io/docs/getting-started/results-output):

```ps
k6 run -e ENDPOINT=http://51.103.1.161:4000/crocodiles -o influxdb=http://localhost:8086/k6  ./stress-test/performance-test1.js
```

![Grafana Configuration](./imagenes/grafanaconf.png)

Before we run a test, lets create a dashboard in Grafana for the Crocodile Metrics. Copy and paste the JSON code in folder `\grafana` and hit save. This custom dashboard will allow you to visually track:

- HTTP Request Rate (sourced from both k6 and application via Prometheus)
- Number of virtual users
- Number of active application pods and their status
- 99th percentile response time (measured in milliseconds)
- Memory usage per pod (measured in megabytes)

![grafana_run.png](./imagenes/grafana_run.png)

## Configuring Horizontal Pod Autoscaling with Keda

In the previous execution as the number of http requests per second increases, the number of pods stays constant. We can now configure KEDA to monitor and scale our application. Open the YAML config file keda/keda-prometheus-scaledobject located in the project and analyze it:

lets check where we can reachthe Prometheus service. We will use Prometheus as the metrics source for Keda:

```ps
kubectl get svc -n seguimiento

NAME                 TYPE           CLUSTER-IP     EXTERNAL-IP    PORT(S)          AGE
grafana              LoadBalancer   10.0.89.160    51.103.2.197   3000:31674/TCP   2d14h
prometheus-service   LoadBalancer   10.0.122.197   51.103.2.45    8084:30428/TCP   3d5h
```

Since we are going to access the service from withing the Kubernetes cluster, the Keda resource will be:

```yaml
apiVersion: keda.k8s.io/v1alpha1
kind: ScaledObject
metadata:
  name: prometheus-scaledobject
  namespace: default
  labels:
    deploymentName: crocodile-api
spec:
  scaleTargetRef:
    deploymentName: crocodile-api
  pollingInterval: 10  # Optional. Default: 30 seconds
  cooldownPeriod:  15 # Optional. Default: 300 seconds
  minReplicaCount: 1   # Optional. Default: 0
  maxReplicaCount: 10 # Optional. Default: 100
  triggers:
  - type: prometheus
    metadata:
      # Required
      serverAddress: http://10.0.122.197:8084
      metricName: access_frequency
      threshold: '50'
      query: sum(rate(node_http_requests_total[2m]))
```

Take note of the query we provided:

```yaml
sum(rate(node_http_requests_total[2m]))
```

KEDA will run this query on Prometheus every 10 seconds. We've added the sum function to the expression in order to include data from all running pods. It will check the value against the threshold we provided, 50. If the value exceeds this amount, KEDA will increase the number of running pods up-to a maximum of 10. If the value is less, KEDA will scale our application pods back to 1. To deploy this configuration, execute the following command:

```ps
kubectl apply -f .\keda\keda-prometheus-scaledobject.yml
```

We can see now in the Grafana dashboard the inmediate effect of the Keda scaler. The number of pods has increased to 10, from 7, so that meanst that four additional crocodile-api pods have been started. Also notice how the number of requests per second is reduced drastically to something withing the threshold we have set:

![grafana_runwithKeda.png](./imagenes/grafana_runwithKeda.png)

We can also see the new pods:

```ps
kubectl get po

NAME                              READY   STATUS    RESTARTS   AGE
crocodile-api-5947d94679-2kxxz    2/2     Running   0          2m28s
crocodile-api-5947d94679-dkdwh    2/2     Running   0          2m28s
crocodile-api-5947d94679-s5j9b    2/2     Running   12         3d14h
crocodile-api-5947d94679-tl5dk    2/2     Running   0          2m28s
details-v1-7f6df6f54-qknjk        2/2     Running   14         5d21h
productpage-v1-69886c8bcb-8j79x   2/2     Running   6          2d15h
ratings-v1-6665bbd4db-gg9sn       2/2     Running   6          2d15h
reviews-v1-7fd87d96bd-gzq4m       2/2     Running   14         5d21h
reviews-v2-55d9bfb6d8-68zpg       2/2     Running   6          2d15h
reviews-v3-5776c54c64-k72cs       2/2     Running   14         5d21h
```

After a while, the things get back to normal:

![grafana_runwithKeda2.png](./imagenes/grafana_runwithKeda2.png)

```ps
kubectl get po

NAME                              READY   STATUS    RESTARTS   AGE
crocodile-api-5947d94679-s5j9b    2/2     Running   12         3d14h
details-v1-7f6df6f54-qknjk        2/2     Running   14         5d21h
productpage-v1-69886c8bcb-8j79x   2/2     Running   6          2d16h
ratings-v1-6665bbd4db-gg9sn       2/2     Running   6          2d16h
reviews-v1-7fd87d96bd-gzq4m       2/2     Running   14         5d21h
reviews-v2-55d9bfb6d8-68zpg       2/2     Running   6          2d15h
reviews-v3-5776c54c64-k72cs       2/2     Running   14         5d21h
```

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