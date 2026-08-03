import './styles.css';
import { AppController } from './app-controller';

const root = document.getElementById('app');

if (!root) {
  throw new Error('app-root-not-found');
}

const controller = new AppController(root);
void controller.start();
