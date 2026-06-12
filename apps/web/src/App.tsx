import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Bots } from './pages/Bots'
import { BotDetail } from './pages/BotDetail'
import { Strategies } from './pages/Strategies'
import { StrategyDetail } from './pages/StrategyDetail'
import { Backtests } from './pages/Backtests'
import { BacktestDetail } from './pages/BacktestDetail'
import { Optimizer } from './pages/Optimizer'
import { OptimizationDetail } from './pages/OptimizationDetail'
import { PatternLab } from './pages/PatternLab'
import { DataManager } from './pages/DataManager'
import { TradesPage } from './pages/TradesPage'
import { Settings } from './pages/Settings'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/bots" element={<Bots />} />
        <Route path="/bots/:id" element={<BotDetail />} />
        <Route path="/strategies" element={<Strategies />} />
        <Route path="/strategies/:id" element={<StrategyDetail />} />
        <Route path="/backtests" element={<Backtests />} />
        <Route path="/backtests/:id" element={<BacktestDetail />} />
        <Route path="/optimizer" element={<Optimizer />} />
        <Route path="/optimizer/:id" element={<OptimizationDetail />} />
        <Route path="/patterns" element={<PatternLab />} />
        <Route path="/data" element={<DataManager />} />
        <Route path="/trades" element={<TradesPage />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
