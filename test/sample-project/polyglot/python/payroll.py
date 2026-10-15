from dataclasses import dataclass


@dataclass
class Employee:
    name: str
    monthly_salary: float
    leave_days: int


def leave_deduction(employee: Employee) -> float:
    return employee.monthly_salary / 21 * employee.leave_days


def tax(gross: float) -> float:
    return gross * 0.3


def net_salary(employee: Employee) -> float:
    gross = employee.monthly_salary - leave_deduction(employee)
    return gross - tax(gross)


def payslip_line(employee: Employee) -> str:
    return f"{employee.name}: {net_salary(employee):.2f}"


def run_payroll(employees: list[Employee]) -> list[str]:
    return [payslip_line(employee) for employee in employees]


if __name__ == "__main__":
    staff = [Employee("Ada", 52000, 2), Employee("Linus", 48000, 0)]
    for line in run_payroll(staff):
        print(line)
