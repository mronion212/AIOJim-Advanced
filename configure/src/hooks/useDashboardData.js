import { useState, useEffect } from 'react';
import { useAdmin } from '@/contexts/AdminContext';

const API_BASE = process.env.NODE_ENV === 'development' 
  ? 'http://localhost:7000' 
  : window.location.origin;

export function useDashboardData() {
  const { adminKey, isAdmin } = useAdmin();
  const [data, setData] = useState({
    systemOverview: null,
    quickStats: null,
    cachePerformance: null,
    providerPerformance: null,
    systemConfig: null,
    resourceUsage: null,
    errorLogs: null,
    maintenanceTasks: null
  });
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Only fetch if user is admin
      if (!isAdmin) {
        setLoading(false);
        return;
      }

      // Fetch all dashboard data
      const headers = {
        'Content-Type': 'application/json'
      };
      
      if (adminKey) {
        headers['x-admin-key'] = adminKey;
      }

      const response = await fetch(`${API_BASE}/api/dashboard/overview`, {
        headers
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const dashboardData = await response.json();
      setData(dashboardData);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const clearCache = async (type) => {
    try {
      const headers = {
        'Content-Type': 'application/json'
      };
      
      if (adminKey) {
        headers['x-admin-key'] = adminKey;
      }

      const response = await fetch(`${API_BASE}/api/dashboard/cache/clear`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ type })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      // Refresh data after cache clear
      if (result.success) {
        await fetchData();
      }

      return result;
    } catch (err) {
      console.error('Error clearing cache:', err);
      throw err;
    }
  };

  useEffect(() => {
    fetchData();
  }, [isAdmin, adminKey]);

  return {
    data,
    loading,
    error,
    refetch: fetchData,
    clearCache
  };
}

export function useDashboardStats() {
  const { adminKey, isAdmin } = useAdmin();
  const [stats, setStats] = useState({
    quickStats: null,
    cachePerformance: null,
    providerPerformance: null
  });
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError(null);

      // Only fetch if user is admin
      if (!isAdmin) {
        setLoading(false);
        return;
      }

      const headers = {
        'Content-Type': 'application/json'
      };
      
      if (adminKey) {
        headers['x-admin-key'] = adminKey;
      }

      const response = await fetch(`${API_BASE}/api/dashboard/stats`, {
        headers
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const statsData = await response.json();
      setStats(statsData);
    } catch (err) {
      console.error('Error fetching dashboard stats:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    
    // Auto-refresh every 30 seconds to get updated provider performance data
    const interval = setInterval(fetchStats, 30000);
    
    return () => clearInterval(interval);
  }, [isAdmin, adminKey]);

  return {
    stats,
    loading,
    error,
    refetch: fetchStats
  };
}

export function useDashboardSystem() {
  const { adminKey, isAdmin } = useAdmin();
  const [systemData, setSystemData] = useState({
    systemConfig: null,
    resourceUsage: null
  });
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchSystemData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Only fetch if user is admin
      if (!isAdmin) {
        setLoading(false);
        return;
      }

      const headers = {
        'Content-Type': 'application/json'
      };
      
      if (adminKey) {
        headers['x-admin-key'] = adminKey;
      }

      const response = await fetch(`${API_BASE}/api/dashboard/system`, {
        headers
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const systemData = await response.json();
      setSystemData(systemData);
    } catch (err) {
      console.error('Error fetching system data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSystemData();
    
    // Auto-refresh every 60 seconds for system data
    const interval = setInterval(fetchSystemData, 60000);
    
    return () => clearInterval(interval);
  }, [isAdmin, adminKey]);

  return {
    systemData,
    loading,
    error,
    refetch: fetchSystemData
  };
}

export function useDashboardOperations() {
  const { adminKey, isAdmin } = useAdmin();
  const [operationsData, setOperationsData] = useState({
    errorLogs: null,
    maintenanceTasks: null
  });
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchOperationsData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Only fetch if user is admin
      if (!isAdmin) {
        setLoading(false);
        return;
      }

      const headers = {
        'Content-Type': 'application/json'
      };
      
      if (adminKey) {
        headers['x-admin-key'] = adminKey;
      }

      const response = await fetch(`${API_BASE}/api/dashboard/operations`, {
        headers
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const operationsData = await response.json();
      setOperationsData(operationsData);
    } catch (err) {
      console.error('Error fetching operations data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOperationsData();
  }, [isAdmin, adminKey]);

  return {
    operationsData,
    loading,
    error,
    refetch: fetchOperationsData
  };
}
