import { group,check, sleep } from 'k6';
import { Trend, Counter,Gauge,Rate  } from 'k6/metrics';
import http from "k6/http";

//***********
//OPCIONES
//***********
//Define los parametros del test
//Número de VU
//rampup/down de VU
//Duración del test
//Métricas a calcular
//Total de 10s. A los 3s tendremos 2VU, a los 8s 5VU, y a los 10s 0VU
export let options = {
  stages: [
    { duration: '3s', target: 2 },
    { duration: '5s', target: 5 },
    { duration: '2s', target: 0 },
  ],
  thresholds: {
    //El test por defecto retorna una serie de KPIs: https://k6.io/docs/using-k6/metrics#built-in-metrics
    //Podemos añadir nuevos KPIS. Los KPIs los podemos construir sobre métricas estandard, o incluso crear métricas custom
    //METRICAS ESTANDARD
    //https://k6.io/docs/using-k6/metrics#http-specific-built-in-metrics
    //peticiones http fallidas
    http_req_failed: ['rate<0.01'],   // La tasa tiene que ser menor que el 1%
    // duracion de peticiones http
    //Podemos tambien definir varios KPIs para una metrica
    // El percentil 90% tiene que estar por debajo de 100ms
    // El percentil 95% tiene que estar por debajo de 200ms
    // El percentil 99.9% tiene que estar por debajo de 2 segundos
    http_req_duration: ['p(90) < 150', 'p(95) < 200', 'p(99.9) < 2000'],
    'http_req_duration{type: miAPI }': ['p(90) < 150', 'p(95) < 200', 'p(99.9) < 2000'],
    //METRICAS CUSTOM
    'duracionGrupo{nombre:peticionesIndividuales}': [{ threshold: 'avg < 400', abortOnFail: true }],
    'duracionGrupo{nombre:peticionesBatch}': ['avg < 150'],
    RTT: ['p(99)<300', 'p(70)<250', 'avg<200', 'med<150', 'min<100'],
    'Contenido OK': ['rate>0.95'],
    'Tamaño': ['value<4000'],
    Errors: ['count<100'],
  },
};
/*
export let options = {
  duration: "15s",
  vus: 2,
  thresholds: {
    http_req_failed: ['rate<0.01'],   // http errors should be less than 1%
    http_req_duration: ['p(95)<200'], // 95% of requests should be below 200ms
  },
};
*/

//***********
//INICIALIZACION
//***********
//Todo lo que se declare como global se ejecuta una vez por cada VU, y pasa a ser el contexto de ejecución de ese VU. Podemos hacer llamadas http, cargar archivos, preparar cross-cutting-concerns,...
let cuenta= 0;

//Vamos a usar esta metrica para comprobar un threshold
let groupDuration = Trend('duracionGrupo');

//Permite calcular la media, mínimo, máximo y percentiles de una serie de valores
export let TrendRTT = new Trend('RTT');
//Determina el porcentaje de valores que no son cero
export let RateContentOK = new Rate('Contenido OK');
//Almacena el último valor en una serie de valores
export let GaugeContentSize = new Gauge('Tamaño');
//Acumula en la métrica los valores de la serie
export let CounterErrors = new Counter('Errors');


//***********
//SETUP DEL TEST
//***********
//Se ejecuta una vez por test - NO una vez por VU -, despues de la inicialización de cada VU
//El objeto que devuelva se pasa como argumento para export function teardown(data) y para export default function (data) {
export function setup() {
  let res = http.get("https://httpbin.org/get");

  //Aserta el contenido de la respuesta
  //Al terminar el test veremos el resultado de estas verificaciones dentro de la sección setup
  check(res, {
    'Ok': (val) => res.status === 200,
    'Hay payload': (val) => res.body.length > 0,
  });

  return { datos: res.json(),v:1 };
}


//***********
// DESMONTAJE DEL TEST
//***********
//Se ejecuta una vez por test - NO una vez por VU -, despues deque haya terminado la ejecución de los VU
//Los datos de entrada son los que produce la función export function setup()
export function teardown(data) {
  if (data.v != 1) {
    throw new Error("incorrect data: " + JSON.stringify(data));
  }
  console.log(JSON.stringify(data.datos));
}


//***********
//DISEÑO DEL TEST
//***********
//Se ejecuta de forma repetida por cada VU. Cada VU ejecuta su contexto, de modo que cuando hagamos referencia a this, el this de cada VU es diferente
//Los datos de entrada son los que produce la función export function setup()
export default function (data) {
  //CONTEXTO DEL TEST
  //Accedemos a los datos que se han definido a nivel de Test. Estos datos se crean en la función setup()
  console.log(JSON.stringify(data.datos));
  console.log(`url: ${data.datos.url}`);
  if("https://httpbin.org/get" == data.datos.url){
    console.log("iguales");
  }

  //CONTEXTO DEL VU
  //this hace referencia a las variables definidas para cada VU. Cada VU tiene su "copia"
  cuenta=cuenta+1;
  console.log(`Numero de ciclos: ${cuenta}`);

  //LLAMADAS HTTP
  //https://k6.io/docs/using-k6/metrics#accessing-http-timings-from-a-script
  //Podemos hacer peticiones http usando el modulo http de K6
  let r = http.get(`http://test.k6.io`, {
    tags: { type: 'miAPI' },
  });

  //Podemos también hacer peticiones http en batches
  http.batch([
    ['GET', `https://test-api.k6.io/public/crocodiles/1/`],
    ['GET', `https://test-api.k6.io/public/crocodiles/2/`],
    ['GET', `https://test-api.k6.io/public/crocodiles/3/`],
  ]);


  //DEFINIR METRICAS CUSTOM
  //Demuestra como hacer peticiones http individuales
  //Demuestra como podemos agruparlas a efectos de poder definir una métrica
  groupWithDurationMetric('peticionesIndividuales', function () {
    http.get('https://test-api.k6.io/public/crocodiles/1/');
    http.get('https://test-api.k6.io/public/crocodiles/2/');
    http.get('https://test-api.k6.io/public/crocodiles/3/');
  });

  //Demuestra como hacer peticiones http en batch
  //Demuestra como podemos agruparlas a efectos de poder definir una métrica
  groupWithDurationMetric('peticionesBatch', function () {
    http.batch([
      ['GET', `https://test-api.k6.io/public/crocodiles/1/`],
      ['GET', `https://test-api.k6.io/public/crocodiles/2/`],
      ['GET', `https://test-api.k6.io/public/crocodiles/3/`],
    ]);
  });

  let res = http.get('https://test-api.k6.io/public/crocodiles/1/');
  let contentOK = res.json('name') === 'Bert';
  //Trend
  TrendRTT.add(res.timings.duration);
  //Rate
  RateContentOK.add(contentOK);
  //Gauge
  GaugeContentSize.add(res.body.length);
  //Counter
  CounterErrors.add(!contentOK);

  //ASSERTIONS
  //Podemos hacer assertions con check
  //Al terminar el test veremos el resultado de estas verificaciones dentro de la sección default
  //Aserta el contenido de data
  check(data, {
    'Valor OK': val => val.v === 1,
    'httpbin OK': val => "https://httpbin.org/get" == val.datos.url
  });

  //Aserta el contenido de la respuesta
  check(r, {
    'Ok': (val) => val.status === 200,
    'Tamaño del body mayor que 1176 bytes': (val) => val.body.length > 1176,
  });

  //PAUSAS
  //Simulamos las pausas del VU
  sleep(3);

}


//***********
//HELPERS
//***********
//Vamos a calcular 
function groupWithDurationMetric(name, group_function) {
  let start = new Date();
  group(name, group_function);
  let end = new Date();
  //Añadimos el valor a la serie, pero la etiquetamos como { nombre: name }
  groupDuration.add(end - start, { nombre: name });
}