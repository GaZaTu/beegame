import React from 'react'
import './App.css'
import BeeGameView from './views/BeeGameView'

const App: React.FC = () => {
  return (
    <div className="App">
      <BeeGameView />
    </div>
  )
}

export default React.memo(App)
