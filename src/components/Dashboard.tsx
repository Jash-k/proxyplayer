import { Tab } from '../App'
import MoviesTab from './MoviesTab'
import SeriesTab from './SeriesTab'
import DatabaseTab from './DatabaseTab'
import DeployTab from './DeployTab'

interface Props {
  tab: Tab
}

export default function Dashboard({ tab }: Props) {
  return (
    <>
      {tab === 'movies'   && <MoviesTab />}
      {tab === 'series'   && <SeriesTab />}
      {tab === 'database' && <DatabaseTab />}
      {tab === 'deploy'   && <DeployTab />}
    </>
  )
}
