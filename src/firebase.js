import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyDA5pC-LNyeCNVPz-BSJbQivtDT4ixoAAk",
            authDomain: "game-cf9d9.firebaseapp.com",
            databaseURL: "https://game-cf9d9-default-rtdb.asia-southeast1.firebasedatabase.app",
            projectId: "game-cf9d9",
            storageBucket: "game-cf9d9.firebasestorage.app",
            messagingSenderId: "588361771189",
            appId: "1:588361771189:web:9dd7b138c76e288fc9b6fc"
};

const app = initializeApp(firebaseConfig);
export const database = getDatabase(app);
