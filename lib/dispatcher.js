var _clone        = require('lodash/lang/clone'),
    _mapValues    = require('lodash/object/mapValues'),
    _forOwn       = require('lodash/object/forOwn'),
    _intersection = require('lodash/array/intersection'),
    _keys         = require('lodash/object/keys'),
    _map          = require('lodash/collection/map'),
    _each         = require('lodash/collection/forEach'),
    _size         = require('lodash/collection/size'),
    _findKey      = require('lodash/object/findKey'),
    _uniq         = require('lodash/array/uniq');

var defaultDispatchInterceptor = function(action, dispatch) {
  dispatch(action);
};

var Dispatcher = function(stores) {
  this.stores              = {};
  this.currentDispatch     = null;
  this.currentActionType   = null;
  this.waitingToDispatch   = [];
  this.dispatchInterceptor = defaultDispatchInterceptor;
  this._boundDispatch      = this._dispatch.bind(this);
  this.dispatchQueue       = [];
  this.activeQueue         = null;

  for(var key in stores) {
    if(stores.hasOwnProperty(key)) {
      this.addStore(key, stores[key]);
    }
  }

  // init queue processing
  // this.processQueue();
};

/**
 * 20180515 MP
 * process the queue of actions as fast as possible
 * NOTE: The minimum window will be set by the browser and is usually between 4-6ms
 * NOTE: The setTimeout will be queued by JS and only processed if "there is time"
 * NOTE: See section "Reasons for delays longer than specified" at https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/setTimeout
 */
Dispatcher.prototype.processQueue = function() {
  var interval  = 0;
  var queueSize = this.dispatchQueue.length;

  if(queueSize === 0) {
    interval = 100;

    if(!!window.MSInputMethodContext && !!document.documentMode) { // for IE <= 11 -> make sure timer is not called too often
      interval = 400;
    }
  } else { // for IE <= 11
    if(!!window.MSInputMethodContext && !!document.documentMode) {
      interval = 100;
    }
  }

  if(!this.currentDispatch && queueSize > 0) {
    var actionToDispatch = this.dispatchQueue.shift();
    // console.info('Dispatching', actionToDispatch);
    this.dispatchInterceptor(actionToDispatch, this._boundDispatch);
  }

  // console.log('QueueSize %s - interval %s', queueSize, interval);
  // console.log('dispatchQueue', this.dispatchQueue);
  clearTimeout(this._processQueueTimeout);
  this._processQueueTimeout = setTimeout(this.processQueue.bind(this), interval);
};

Dispatcher.prototype.addStore = function(name, store) {
  store.dispatcher  = this;
  this.stores[name] = store;
};

// Dispatcher.prototype.dispatch = function(action) {
//   this.dispatchInterceptor(action, this._boundDispatch);
// };

// add new actions to dispatchQueue and sent them to real dispatch only if no other dispatch is active

Dispatcher.prototype.dispatch = function(action) {
  // console.info('Dispat action pushed to que', action);
  if(action.type === 'METADATA_UPDATE_STORE') { // fire metadata update without delay - input lag fix
    this.dispatchInterceptor(action, this._boundDispatch);
  } else { // put every action into a queue - the queue will be processed sequentially by the setInterval function above
    this.dispatchQueue.push(action);
  }

  if(!this.activeQueue) {
    this.processQueue();
  }
};

Dispatcher.prototype._dispatch = function(action) {
  if(!action || !action.type) {
    throw new Error('Can only dispatch actions with a \'type\' property');
  }

  if(this.currentDispatch) {
    var complaint = 'Cannot dispatch an action (\'' + action.type + '\') while another action (\'' +
                    this.currentActionType + '\') is being dispatched';
    throw new Error(complaint);
  }

  this.waitingToDispatch = _clone(this.stores);

  this.currentActionType = action.type;
  this.currentDispatch   = _mapValues(this.stores, function() {
    return { resolved: false, waitingOn: [], waitCallback: null };
  });

  try {
    this.doDispatchLoop(action);
  }
  finally {
    this.currentActionType = null;
    this.currentDispatch   = null;
  }
};

Dispatcher.prototype.doDispatchLoop = function(action) {
  var dispatch, canBeDispatchedTo, wasHandled          = false,
      removeFromDispatchQueue = [], dispatchedThisLoop = [];

  _forOwn(this.waitingToDispatch, function(value, key) {
    dispatch          = this.currentDispatch[key];
    canBeDispatchedTo = !dispatch.waitingOn.length ||
                        !_intersection(dispatch.waitingOn, _keys(this.waitingToDispatch)).length;
    if(canBeDispatchedTo) {
      if(dispatch.waitCallback) {
        var stores            = _map(dispatch.waitingOn, function(key) {
          return this.stores[key];
        }, this);
        var fn                = dispatch.waitCallback;
        dispatch.waitCallback = null;
        dispatch.waitingOn    = [];
        dispatch.resolved     = true;
        fn.apply(null, stores);
        wasHandled = true;
      } else {
        dispatch.resolved = true;
        var handled       = this.stores[key].__handleAction__(action);
        if(handled) {
          wasHandled = true;
        }
      }

      dispatchedThisLoop.push(key);

      if(this.currentDispatch[key].resolved) {
        removeFromDispatchQueue.push(key);
      }
    }
  }, this);

  if(_keys(this.waitingToDispatch).length && !dispatchedThisLoop.length) {
    var storesWithCircularWaits = _keys(this.waitingToDispatch).join(', ');
    throw new Error('Indirect circular wait detected among: ' + storesWithCircularWaits);
  }

  _each(removeFromDispatchQueue, function(key) {
    delete this.waitingToDispatch[key];
  }, this);

  if(_size(this.waitingToDispatch)) {
    this.doDispatchLoop(action);
  }

  if(!wasHandled && console && console.warn) {
    console.warn('An action of type ' + action.type + ' was dispatched, but no store handled it');
  }

};

Dispatcher.prototype.waitForStores = function(store, stores, fn) {
  if(!this.currentDispatch) {
    throw new Error('Cannot wait unless an action is being dispatched');
  }

  var waitingStoreName = _findKey(this.stores, function(val) {
    return val === store;
  });

  if(stores.indexOf(waitingStoreName) > -1) {
    throw new Error('A store cannot wait on itself');
  }

  var dispatch = this.currentDispatch[waitingStoreName];

  if(dispatch.waitingOn.length) {
    throw new Error(waitingStoreName + ' already waiting on stores');
  }

  _each(stores, function(storeName) {
    var storeDispatch = this.currentDispatch[storeName];
    if(!this.stores[storeName]) {
      throw new Error('Cannot wait for non-existent store ' + storeName);
    }
    if(storeDispatch.waitingOn.indexOf(waitingStoreName) > -1) {
      throw new Error('Circular wait detected between ' + waitingStoreName + ' and ' + storeName);
    }
  }, this);

  dispatch.resolved     = false;
  dispatch.waitingOn    = _uniq(dispatch.waitingOn.concat(stores));
  dispatch.waitCallback = fn;
};

Dispatcher.prototype.setDispatchInterceptor = function(fn) {
  if(fn) {
    this.dispatchInterceptor = fn;
  } else {
    this.dispatchInterceptor = defaultDispatchInterceptor;
  }
};

module.exports = Dispatcher;
