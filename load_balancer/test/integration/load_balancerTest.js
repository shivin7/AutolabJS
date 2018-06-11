console.log('======integration tests on load balancer======\n');
/*
best choices for E2E automation testing are:
      cucumber.js - for requirements testing
      mocha.js    - for unit testing
      chai.js     - for assertions
      sinon.js    - for test doubles
      nightmare.js - for headless browser-based testing;
                     to be used with mocha and chai for functional tests
      nightwatch.js - high-level selenium-driver with own assertions;
                      easy to use; to be used with mocha for functional tests
      webdriverIO.js - low-level, but sensible selenium-driver which has to be used with
                      mocha and chai for functional tests
*/

const chai = require('chai');
const dirtyChai = require('dirty-chai');
const request = require('request');
const nock = require('nock');
const sinon = require('sinon');
const rewire = require('rewire');
const proxyquire = require('proxyquire');
const { check } = require('../../../util/environmentCheck.js');
const { Status } = require('../../status.js');
const testData = require('./data/submission.json');
const nodes_data = require(`../../${process.env.LBCONFIG}`);
const lbUrl = `https://${nodes_data.load_balancer.hostname}:${nodes_data.load_balancer.port}`;
const sandbox = sinon.createSandbox();

let loadBalancer;
let logStub;

// eslint-disable-next-line import/no-dynamic-require
check('LBCONFIG');

chai.should();
chai.use(dirtyChai);

const activateNocks = function activateNocks() {
  if (!nock.isActive()) {
    nock.activate();
  }
};

const cleanNocks = function cleanNocks() {
  nock.cleanAll();
  nock.restore();
};

const stubConsole = function stubConsole() {
  logStub = sandbox.stub(console, 'log');
};

const restoreConsole = function restoreConsole() {
  logStub = {};
  sandbox.restore();
};

const startLoadBalancer = function startLoadBalancer() {
  delete require.cache[require.resolve('../../load_balancer.js')];
  // eslint-disable-next-line global-require
  loadBalancer = rewire('../../load_balancer.js');
};

// console.log('* TODO: correctly maintains the list of execution nodes during status check');
// console.log('* TODO: correctly maintains the list of execution nodes during concurrent return of results');
// console.log('* TODO: correctly maintains the list of execution nodes during errors in neighbouring components');
// console.log('* TODO: ignores invalid messages from execution nodes');

describe('Correctly maintains list of ENs', () => {
  beforeEach(() => {
    stubConsole();
    startLoadBalancer();
    restoreConsole();
  });

  afterEach((done) => {
    loadBalancer.server.close(done);
  });

  it('during status check', (done) => {
    stubConsole();
    let testStatus;
    const res = JSON.parse(JSON.stringify(testData.nodesData));
    const lbTestStatus = nodes_data.load_balancer;
    lbTestStatus.status = 'up';
    // proxyquire('./../../load_balancer.js', { 'status': testStatus});
    testStatus = new Status(res);
    loadBalancer.__set__('status', testStatus);    
    sandbox.stub(testStatus, 'checkStatus').callsFake(() => {
      var result = {};
      result.components = JSON.parse(JSON.stringify(res));
      result.components.forEach((elem) => {
        elem.status = 'down';
      });
      return result;
    });
    request.get(`${lbUrl}/connectionCheck`, (error, response) => {
      const responseBody = JSON.parse(response.body);
      response.should.exist();
      responseBody.should.have.all.keys('components', 'job_queue_length', 'timestamp');
      responseBody.job_queue_length.should.equal(loadBalancer.job_queue.length);
      responseBody.timestamp.should.be.a('string');
      responseBody.components.should.be.an('array');
      responseBody.components.should.deep.include(lbTestStatus);
      restoreConsole();
      done();
    });
  });
});

// console.log('* TODO: correctly handles results json with large logs of 50000 lines');
// console.log('* TODO: verifies the authenticity of each execution node before adding it to the worker pool');
// console.log('* TODO: verifies the origins of each evaluation result');
describe('/addNode works correctly', () => {
  const checkAddNode = function checkAddNode(testNodeQueue, resp) {
    stubConsole();
    const testNode = nodes_data.Nodes[0];
    let testJobQueue;
    let updatedNodeQueue;
    setTimeout(() => {
      testJobQueue = JSON.parse(JSON.stringify(loadBalancer.__get__('job_queue')));
      loadBalancer.__set__('node_queue', JSON.parse(JSON.stringify(testNodeQueue)));
      request.post(`${lbUrl}/addNode`, { json: testNode }, (error, response) => {
        (error === null).should.be.true();
        response.body.should.equal(true);
        updatedNodeQueue = loadBalancer.__get__('node_queue');
        if (testJobQueue.length === 0) {
          updatedNodeQueue.should.be.an('array').that.deep.includes(testNode);
          if (testNodeQueue.length === 0)     // EN just started and no job
            sinon.assert.calledThrice(logStub);
          else                                // EN already in node queue and no job
            sinon.assert.calledOnce(logStub);
        }
        restoreConsole();
        resp();
      });
    }, 50);
  };

  beforeEach(() => {
    stubConsole();
    startLoadBalancer();
    restoreConsole();
    activateNocks();
  });

  afterEach((done) => {
    cleanNocks();
    loadBalancer.server.close(done);
  });

  it('when EN has just started and no job', (done) => {
    loadBalancer.__set__('job_queue', []);
    checkAddNode([], () => {
      done();
    });
  });

  it('when EN is already in node queue and no job', (done) => {
    loadBalancer.__set__('job_queue', []);
    checkAddNode(testData.nodesData, () => {
      done();
    });
  });

  it('when a job is pending', (done) => {
    const enUrl = `https://${nodes_data.Nodes[0].hostname}:${nodes_data.Nodes[0].port}`;
    const testJobQueue = JSON.parse(JSON.stringify(testData.submissionsData));
    let testJobQueueSetter = JSON.parse(JSON.stringify(testJobQueue));
    loadBalancer.__set__('job_queue', testJobQueueSetter);
    nock(enUrl)
      .post('/requestRun')
      .reply(200, (uri, requestBody) => {
        requestBody.should.have.all.keys('id_no', 'Lab_No', 'time', 'commit', 'status', 'penalty', 'socket', 'language');
        requestBody.should.deep.equal(testJobQueue[2]);
        testJobQueue.pop();
        testJobQueueSetter.should.deep.equal(testJobQueue);
        loadBalancer.__get__('node_queue').should.be.an('array').that.has.lengthOf(1);
        return true;
      });
    checkAddNode(testData.nodesData, () => {
      done();
    });
  });

  it('when incorrect EN sends addNode request', (done) => {
    const wrongNode = {
      role: 'execution_node',
      hostname: 'localhost',
      port: '8087',
    };
    let testJobQueue = JSON.parse(JSON.stringify(testData.submissionsData));
    stubConsole();
    setTimeout(() => {
      loadBalancer.__set__('node_queue', JSON.parse(JSON.stringify([])));
      loadBalancer.__set__('job_queue', testJobQueue);
      request.post(`${lbUrl}/addNode`, { json: wrongNode });
    }, 50);
    setTimeout(() => {
      sinon.assert.calledWith(logStub.getCall(3), sinon.match.has('code', 'ECONNREFUSED'));
      sinon.assert.calledWith(logStub.getCall(3), sinon.match.has('port', parseInt(wrongNode.port, 10)));
      restoreConsole();
      done();
    }, 100);
  });
});

describe('/submit works correctly', () => {
  beforeEach(() => {
    stubConsole();
    startLoadBalancer();
    restoreConsole();
    activateNocks();
  });

  afterEach((done) => {
    cleanNocks();
    loadBalancer.server.close(done);
  });

  it('when no node available to process request', (done) => {
    stubConsole();
    let testJobQueue = JSON.parse(JSON.stringify(testData.submissionsData));
    const newJob = testJobQueue.pop();
    setTimeout(() => {
      loadBalancer.__set__('job_queue', testJobQueue);
      loadBalancer.__set__('node_queue', JSON.parse(JSON.stringify([])));
      request.post(`${lbUrl}/submit`, { json: newJob }, (error, response) => {
        (error === null).should.be.true;
        response.body.should.equal(true);
        loadBalancer.__get__('node_queue').should.be.an('array').that.is.empty;
        loadBalancer.__get__('job_queue').should.deep.equal(testData.submissionsData);
        restoreConsole();
        done();
      });
    }, 50);
  });

  it('when node is available to process request', (done) => {
    stubConsole();
    let testJobQueue = JSON.parse(JSON.stringify(testData.submissionsData));
    let testNodeQueue = JSON.parse(JSON.stringify(testData.nodesData));
    const assignedNode = testNodeQueue[1];
    const newJob = testJobQueue[2];
    const enUrl = `https://${assignedNode.hostname}:${assignedNode.port}`;
    nock(enUrl)
      .post('/requestRun')
      .reply(200, (uri, requestBody) => {
        requestBody.should.have.all.keys('id_no', 'Lab_No', 'time', 'commit', 'status', 'penalty', 'socket', 'language');
        requestBody.should.deep.equal(newJob);
        return true;
      });
    setTimeout(() => {
      testJobQueue.pop();
      loadBalancer.__set__('job_queue', testJobQueue);
      loadBalancer.__set__('node_queue', JSON.parse(JSON.stringify(testNodeQueue)));
      testNodeQueue.pop();
      request.post(`${lbUrl}/submit`, { json: newJob }, (error, response) => {
        (error === null).should.be.true;
        response.body.should.equal(true);
        loadBalancer.__get__('node_queue').should.deep.equal(testNodeQueue);
        loadBalancer.__get__('job_queue').should.deep.equal(testJobQueue);
        restoreConsole();
        done();
      });
    }, 50);
  });
});

// console.log('* TODO: Remains online and active when database is offline');
// console.log('* TODO: Connects to database when database comes back online');

// console.log('* TODO: Sets aside execution nodes that are offiline');
// console.log('* TODO: incoming requests are distributed uniformly among all execution nodes');

// console.log('* TODO: A user cancelled evaluation request is removed from job queue');
// console.log('* TODO: Informs execution node about a cancelled job.');

// console.log('* TODO: Accept requests / results only from authorized execution nodes');
// console.log('* TODO: Uses a valid SSL certificate');
