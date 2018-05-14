/**
 * CHANGELOG for this file
 * 2018-08-05 MP
 * The application should be able to inject flux directly as option instead of props or deprecated context.
 * Therefore this function checks for an object in the stores and considers that an "option object"
 * 
 * Usage: StoreWatchMixing('Store1', 'Store2', { flux: flux })
 * 
 */
var _ = require('lodash')

var StoreWatchMixin = function() {
  var storeNames = Array.prototype.slice.call(arguments);
  var fluxInstance
  storeNames = _.filter(storeNames, function(store) {
    if (_.isPlainObject(store) && _.get(store, 'flux')) fluxInstance = _.get(store, 'flux')
    else return store
  })
  return {
    componentDidMount: function() {
      var flux = fluxInstance || this.props.flux || this.context.flux;
      this.mounted = true;

      // No autobinding in ES6 classes
      this._setStateFromFlux = function() {
        if(this.mounted) {
          this.setState(this.getStateFromFlux());
          //console.log('StoreWatchMixing -> Change emitted from', this.emittingStore)
        }
      }.bind(this);

      _.forEach(storeNames, function(store) {
        var fluxStore = _.get(flux, 'stores.' + store)
        if (fluxStore) {
          this.emittingStore = store // this way flux can display which store emitted (helpful for debugging)
          fluxStore.on("change", this._setStateFromFlux);
        }        
      }, this);
    },

    componentWillUnmount: function() {
      var flux = fluxInstance || this.props.flux || this.context.flux;
      this.mounted = false;
      _.forEach(storeNames, function(store) {
        var fluxStore = _.get(flux, 'stores.' + store)
        if (fluxStore) {
          fluxStore.removeListener("change", this._setStateFromFlux);
        }        
      }, this);
    },

    getInitialState: function() {
      return this.getStateFromFlux();
    }
  };
};

StoreWatchMixin.componentWillMount = function() {
  throw new Error("Fluxxor.StoreWatchMixin is a function that takes one or more " +
    "store names as parameters and returns the mixin, e.g.: " +
    "mixins: [Fluxxor.StoreWatchMixin(\"Store1\", \"Store2\")]");
};

module.exports = StoreWatchMixin;
