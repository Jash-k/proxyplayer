export interface Movie {
  id: string
  pixeldrain_id: string
  title: string
  year: number
  genre: string
  poster: string
  added_at: string
}

export interface Series {
  id: string
  pixeldrain_id: string
  title: string
  year: number
  genre: string
  season: number
  episode: number
  episode_title: string
  poster: string
  added_at: string
}

export const mockMovies: Movie[] = [
  {
    id: '1',
    pixeldrain_id: 'AbCdEf12',
    title: 'Interstellar',
    year: 2014,
    genre: 'Sci-Fi',
    poster: 'https://image.tmdb.org/t/p/w200/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
    added_at: '2024-01-10',
  },
  {
    id: '2',
    pixeldrain_id: 'GhIjKl34',
    title: 'Oppenheimer',
    year: 2023,
    genre: 'Drama',
    poster: 'https://image.tmdb.org/t/p/w200/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
    added_at: '2024-01-12',
  },
  {
    id: '3',
    pixeldrain_id: 'MnOpQr56',
    title: 'Dune Part Two',
    year: 2024,
    genre: 'Sci-Fi',
    poster: 'https://image.tmdb.org/t/p/w200/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
    added_at: '2024-03-05',
  },
]

export const mockSeries: Series[] = [
  {
    id: '1',
    pixeldrain_id: 'StUvWx78',
    title: 'Breaking Bad',
    year: 2008,
    genre: 'Crime',
    season: 1,
    episode: 1,
    episode_title: 'Pilot',
    poster: 'https://image.tmdb.org/t/p/w200/ggFHVNu6YYI5L9pCfOacjizRGt.jpg',
    added_at: '2024-01-15',
  },
  {
    id: '2',
    pixeldrain_id: 'YzAbCd90',
    title: 'Breaking Bad',
    year: 2008,
    genre: 'Crime',
    season: 1,
    episode: 2,
    episode_title: "Cat's in the Bag",
    poster: 'https://image.tmdb.org/t/p/w200/ggFHVNu6YYI5L9pCfOacjizRGt.jpg',
    added_at: '2024-01-15',
  },
  {
    id: '3',
    pixeldrain_id: 'EfGhIj12',
    title: 'The Bear',
    year: 2022,
    genre: 'Drama',
    season: 1,
    episode: 1,
    episode_title: 'System',
    poster: 'https://image.tmdb.org/t/p/w200/sHFlbKS3WLqMnp9t2ghADIJFnuQ.jpg',
    added_at: '2024-02-20',
  },
]
