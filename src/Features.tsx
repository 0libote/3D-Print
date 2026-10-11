import { createContext, useContext } from "react";
import { featureDefaults } from "../shared/features";
export const FeaturesContext = createContext(featureDefaults);
export const useFeatures = () => useContext(FeaturesContext);
