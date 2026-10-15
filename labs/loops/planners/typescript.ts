export type Plan = {
    action: string;
    suggestion: string;
  };
  
  export function createPlan(feedback: string): Plan {
    if (feedback.includes("TS2741")) {
      return {
        action: "add_missing_property",
        suggestion: "Add the missing required property to the object"
      };
    }
  
    if (feedback.includes("TS2554")) {
      return {
        action: "fix_function_arguments",
        suggestion: "Check the number of arguments passed to the function"
      };
    }
  
    if (feedback.includes("TS2339")) {
      return {
        action: "fix_missing_property",
        suggestion: "Property does not exist on this type. Check spelling or interface"
      };
    }
  
    return {
      action: "manual_review",
      suggestion: "Please review the error and fix manually"
    };
  }