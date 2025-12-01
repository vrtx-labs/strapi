import 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../features/Auth.mjs';

const PrivateRoute = ({ children })=>{
    const token = useAuth('PrivateRoute', (state)=>state.token);
    useLocation();
    return token !== null ? children : children;
};

export { PrivateRoute };
//# sourceMappingURL=PrivateRoute.mjs.map
