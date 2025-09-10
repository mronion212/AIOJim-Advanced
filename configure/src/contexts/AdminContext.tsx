import React, { createContext, useContext, useState, useEffect } from 'react';

interface AdminContextType {
  isAdmin: boolean;
  adminKey: string | null;
  login: (key: string) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
}

const AdminContext = createContext<AdminContextType | undefined>(undefined);

const ADMIN_KEY_STORAGE = 'admin-key';
const ADMIN_SESSION_STORAGE = 'admin-session';

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check if admin features are available (ADMIN_KEY is set and working)
  const checkAdminFeaturesAvailable = async (): Promise<boolean> => {
    try {
      // Try to access an admin-only endpoint to see if ADMIN_KEY is set
      const response = await fetch('/api/dashboard/users', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      // If it returns 401, admin features are available but require authentication
      // If it returns 200, admin features are disabled (no ADMIN_KEY set)
      return response.status === 401;
    } catch (error) {
      return false;
    }
  };

  // Check for existing admin session on mount
  useEffect(() => {
    const checkExistingSession = async () => {
      try {
        // First check if admin features are available (ADMIN_KEY is set)
        const adminFeaturesAvailable = await checkAdminFeaturesAvailable();
        if (!adminFeaturesAvailable) {
          // Admin features are disabled (no ADMIN_KEY set)
          setIsAdmin(false);
          setAdminKey(null);
          setIsLoading(false);
          return;
        }

        // Admin features are available and require authentication, check for existing session
        const storedKey = sessionStorage.getItem(ADMIN_KEY_STORAGE);
        const sessionActive = sessionStorage.getItem(ADMIN_SESSION_STORAGE);
        
        if (storedKey && sessionActive) {
          // Verify the key is still valid
          const isValid = await verifyAdminKey(storedKey);
          if (isValid) {
            setAdminKey(storedKey);
            setIsAdmin(true);
          } else {
            // Clear invalid session
            sessionStorage.removeItem(ADMIN_KEY_STORAGE);
            sessionStorage.removeItem(ADMIN_SESSION_STORAGE);
          }
        }
      } catch (error) {
        console.error('Error checking admin session:', error);
        // Clear any invalid session data
        sessionStorage.removeItem(ADMIN_KEY_STORAGE);
        sessionStorage.removeItem(ADMIN_SESSION_STORAGE);
      } finally {
        setIsLoading(false);
      }
    };

    checkExistingSession();
  }, []);

  const verifyAdminKey = async (key: string): Promise<boolean> => {
    try {
      // Try with the provided admin key on an admin-only endpoint
      const responseWithKey = await fetch('/api/dashboard/users', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': key
        }
      });
      
      return responseWithKey.ok;
    } catch (error) {
      console.error('Error verifying admin key:', error);
      return false;
    }
  };

  const login = async (key: string): Promise<boolean> => {
    try {
      setIsLoading(true);
      const isValid = await verifyAdminKey(key);
      
      if (isValid) {
        setAdminKey(key);
        setIsAdmin(true);
        sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
        sessionStorage.setItem(ADMIN_SESSION_STORAGE, 'true');
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error('Error during admin login:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setAdminKey(null);
    setIsAdmin(false);
    sessionStorage.removeItem(ADMIN_KEY_STORAGE);
    sessionStorage.removeItem(ADMIN_SESSION_STORAGE);
  };

  const value: AdminContextType = {
    isAdmin,
    adminKey,
    login,
    logout,
    isLoading
  };

  return (
    <AdminContext.Provider value={value}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  const context = useContext(AdminContext);
  if (context === undefined) {
    throw new Error('useAdmin must be used within an AdminProvider');
  }
  return context;
}
