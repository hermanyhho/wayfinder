namespace Payroll;

public record Employee(string Name, decimal MonthlySalary, int LeaveDays);

public static class PayrollRun
{
    public static decimal LeaveDeduction(Employee employee) => employee.MonthlySalary / 21 * employee.LeaveDays;

    public static decimal Tax(decimal gross) => gross * 0.3m;

    public static decimal NetSalary(Employee employee)
    {
        var gross = employee.MonthlySalary - LeaveDeduction(employee);
        return gross - Tax(gross);
    }

    public static string PayslipLine(Employee employee) => $"{employee.Name}: {NetSalary(employee):F2}";

    public static IEnumerable<string> Run(IEnumerable<Employee> employees) => employees.Select(employee => PayslipLine(employee));

    public static void Main()
    {
        var staff = new[] { new Employee("Ada", 52000, 2), new Employee("Linus", 48000, 0) };
        foreach (var line in Run(staff)) Console.WriteLine(line);
    }
}
