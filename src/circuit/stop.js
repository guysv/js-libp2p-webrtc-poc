'use strict'

const wrtc = require('wrtc')
const SimplePeer = require('simple-peer')
const isNode = require('detect-node')
const toPull = require('stream-to-pull-stream')
const pull = require('pull-stream/pull')
const drain = require('pull-stream/sinks/drain')
const Pushable = require('pull-pushable')
const setImmediate = require('async/setImmediate')

const EE = require('events').EventEmitter
const Connection = require('interface-connection').Connection
const utilsFactory = require('./utils')
const PeerInfo = require('peer-info')
const proto = require('../protocol').CircuitRelay
const series = require('async/series')

const debug = require('debug')

const log = debug('libp2p:circuit:stop')
log.err = debug('libp2p:circuit:error:stop')

class Stop extends EE {
  constructor (swarm) {
    super()
    this.swarm = swarm
    this.utils = utilsFactory(swarm)
  }

  /**
   * Handle the incoming STOP message
   *
   * @param {{}} msg  - the parsed protobuf message
   * @param {StreamHandler} sh  - the stream handler wrapped connection
   * @param {Function} callback  - callback
   * @returns {undefined}
   */
  handle (msg, sh, callback) {
    callback = callback || (() => {})

    series([
      (cb) => this.utils.validateAddrs(msg, sh, proto.Type.STOP, cb),
      (cb) => this.utils.writeResponse(sh, proto.Status.Success, cb)
    ], (err) => {
      if (err) {
        // we don't return the error here,
        // since multistream select don't expect one
        callback()
        return log(err)
      }

      const peerInfo = new PeerInfo(this.utils.peerIdFromId(msg.srcPeer.id))
      msg.srcPeer.addrs.forEach((addr) => peerInfo.multiaddrs.add(addr))
      const newConn = new Connection(sh.rest())
      newConn.setPeerInfo(peerInfo)

      const channel = new SimplePeer({wrtc: isNode ? wrtc : null})
      const dstConn = new Connection(toPull.duplex(channel))

      var p = Pushable()

      pull(
        p,
        newConn,
        drain(data => {
          log('Read signal from circuit connection')
          channel.signal(JSON.parse(data))
        })
      )

      // dstConn.setInnerConn(conn)
      channel.on('signal', (signal) => {
        log('Writing signal to circuit connection')
        p.push(JSON.stringify(signal))
      })

      channel.on('connect', () => {
        log('Connected!')
        setImmediate(() => this.emit('connection', dstConn))
        callback(dstConn)
      })
      
    })
  }
}

module.exports = Stop
