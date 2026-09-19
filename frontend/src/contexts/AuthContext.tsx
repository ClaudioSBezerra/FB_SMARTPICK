import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

interface User {
  id: string;
  email: string;
  full_name: string;
  trial_ends_at: string;
  role?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  environment: string | null;
  group: string | null;
  company: string | null;
  companyId: string | null;
  cnpj: string | null;
  spRole: string | null;
  loading: boolean;
  login: (data: any) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [cnpj, setCnpj] = useState<string | null>(null);
  const [spRole, setSpRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSpRole = (tok: string) => {
    fetch('/api/sp/me', { headers: { Authorization: `Bearer ${tok}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.sp_role) setSpRole(d.sp_role) })
      .catch(() => {});
  };

  // Ref para o interceptor de fetch (sem stale closure)
  const tokenRef = useRef<string | null>(null);
  useEffect(() => { tokenRef.current = token; }, [token]);

  // Interceptor global de fetch: injeta Authorization em todas as chamadas
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = new Headers(init.headers || {});
      if (!headers.has('Authorization') && tokenRef.current) {
        headers.set('Authorization', `Bearer ${tokenRef.current}`);
      }
      return originalFetch(input, { ...init, headers });
    };
    return () => { window.fetch = originalFetch; };
  }, []);

  useEffect(() => {
    // Restore session from localStorage
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    const storedEnv = localStorage.getItem('environment');
    const storedGroup = localStorage.getItem('group');
    const storedCompany = localStorage.getItem('company');
    const storedCompanyId = localStorage.getItem('companyId');
    const storedCnpj = localStorage.getItem('cnpj');

    if (storedToken && storedUser) {
      setToken(storedToken);
      tokenRef.current = storedToken;
      setUser(JSON.parse(storedUser));
      setEnvironment(storedEnv);
      setGroup(storedGroup);
      setCompany(storedCompany);
      setCompanyId(storedCompanyId);
      setCnpj(storedCnpj);

      // Refresh user profile from server to ensure role and trial status are up to date
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${storedToken}` }
      })
      .then(res => {
        if (res.ok) return res.json();
        if (res.status === 401) {
          localStorage.clear();
          window.location.href = '/login';
          throw new Error('Session expired');
        }
        throw new Error('Failed to refresh user data');
      })
      .then(userData => {
        setUser(userData);
        localStorage.setItem('user', JSON.stringify(userData));
        fetchSpRole(storedToken);
      })
      .catch(err => console.error("Session refresh error:", err))
      .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = (data: any) => {
    setToken(data.token);
    setUser(data.user);
    setEnvironment(data.environment_name);
    setGroup(data.group_name);
    setCompany(data.company_name);
    setCompanyId(data.company_id);
    setCnpj(data.cnpj);

    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    localStorage.setItem('environment', data.environment_name || '');
    localStorage.setItem('group', data.group_name || '');
    localStorage.setItem('company', data.company_name || '');
    localStorage.setItem('companyId', data.company_id || '');
    localStorage.setItem('cnpj', data.cnpj || '');
    fetchSpRole(data.token);
  };

  const logout = () => {
    localStorage.clear();

    setUser(null);
    setToken(null);
    setEnvironment(null);
    setGroup(null);
    setCompany(null);
    setCompanyId(null);
    setCnpj(null);
    setSpRole(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{
      user,
      token,
      environment,
      group,
      company,
      companyId,
      cnpj,
      spRole,
      loading,
      login,
      logout,
      isAuthenticated: !!user
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
