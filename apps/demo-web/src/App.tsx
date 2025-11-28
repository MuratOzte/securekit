// apps/demo-web/src/App.tsx

import React from "react";
import { LocationCheckTester } from "./components/LocationCheckTester"; // .js uzantısı önemli

function App() {
  return (
    <div>
      {/* mevcut içeriklerin varsa onlar */}
      <LocationCheckTester />
    </div>
  );
}

export default App;
