import Dexie, { Table } from 'dexie';
import { WordEntry } from '../contexts/WordsContext';

export class FlashcardDB extends Dexie {
  words!: Table<WordEntry>;

  constructor() {
    super('flashcardDB');
    this.version(1).stores({
      words: '++id, word, box, nextReview' // Indexes for faster queries
    });
  }
} 
