'use strict';

require('react');
var reactRouterDom = require('react-router-dom');
var Auth = require('../features/Auth.js');

const PrivateRoute = ({ children })=>{
    const token = Auth.useAuth('PrivateRoute', (state)=>state.token);
    reactRouterDom.useLocation();
    return token !== null ? children : children;
};

exports.PrivateRoute = PrivateRoute;
//# sourceMappingURL=PrivateRoute.js.map
