'use strict'
var helper = require('./test-helper')
const pg = helper.pg

const suite = new helper.Suite()
suite.test('connecting to invalid port', (cb) => {
  const pool = new pg.Pool({ port: 13801 })
  pool.connect().catch(e => cb())
})

suite.test('errors emitted on pool', (cb) => {
  // make pool hold 2 clients
  const pool = new pg.Pool({ max: 2 })
  // get first client
  pool.connect(assert.success(function (client, done) {
    client.id = 1
    client.query('SELECT NOW()', function () {
      pool.connect(assert.success(function (client2, done2) {
        client2.id = 2
        var pidColName = 'procpid'
        helper.versionGTE(client2, 90200, assert.success(function (isGreater) {
          var killIdleQuery = 'SELECT pid, (SELECT pg_terminate_backend(pid)) AS killed FROM pg_stat_activity WHERE state = $1'
          var params = ['idle']
          if (!isGreater) {
            killIdleQuery = 'SELECT procpid, (SELECT pg_terminate_backend(procpid)) AS killed FROM pg_stat_activity WHERE current_query LIKE $1'
            params = ['%IDLE%']
          }

          pool.once('error', (err, brokenClient) => {
            assert.ok(err)
            assert.ok(brokenClient)
            assert.equal(client.id, brokenClient.id)
            cb()
          })

          // kill the connection from client
          client2.query(killIdleQuery, params, assert.success(function (res) {
            // check to make sure client connection actually was killed
            // return client2 to the pool
            done2()
            pool.end()
          }))
        }))
      }))
    })
  }))
})

suite.test('connection-level errors cause queued queries to fail', (cb) => {
  const pool = new pg.Pool()
  pool.connect(assert.success((client, done) => {
    client.query('SELECT pg_terminate_backend(pg_backend_pid())', assert.calls((err) => {
      if (helper.args.native) {
        assert.ok(err)
      } else {
        assert.equal(err.code, '57P01')
      }
    }))

    pool.once('error', assert.calls((err, brokenClient) => {
      assert.equal(client, brokenClient)
    }))

    client.query('SELECT 1', assert.calls((err) => {
      if (helper.args.native) {
        assert.ok(err)
      } else {
        assert.equal(err.message, 'Connection terminated unexpectedly')
      }

      done()
      pool.end()
      cb()
    }))
  }))
})

suite.test('connection-level errors cause future queries to fail', (cb) => {
  const pool = new pg.Pool()
  pool.connect(assert.success((client, done) => {
    client.query('SELECT pg_terminate_backend(pg_backend_pid())', assert.calls((err) => {
      if (helper.args.native) {
        assert.ok(err)
      } else {
        assert.equal(err.code, '57P01')
      }
    }))

    pool.once('error', assert.calls((err, brokenClient) => {
      assert.equal(client, brokenClient)

      client.query('SELECT 1', assert.calls((err) => {
        assert.equal(err.message, 'Client has encountered a connection error and is not queryable')

        done()
        pool.end()
        cb()
      }))
    }))
  }))
})
