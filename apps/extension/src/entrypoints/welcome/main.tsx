import '@audion/ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OnboardingApp } from '../../pages/onboarding/OnboardingApp';
import '../../pages/onboarding/onboarding.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OnboardingApp intro />
  </StrictMode>,
);
